import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { invoke } from "@/lib/api";

interface UserInfo {
  isLogin?: boolean;
  is_login?: boolean;
  uname: string;
  mid: number;
  face: string;
}

/**
 * 监听 config.sessdata 变化，自动获取/清除用户信息
 * 模拟 Vue 的 watch 行为
 */
export function useConfigWatch() {
  const config = useAppStore((s) => s.config);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const prevSessdataRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentSessdata = config?.sessdata || "";
    const prevSessdata = prevSessdataRef.current;

    if (prevSessdataRef.current === undefined) {
      prevSessdataRef.current = currentSessdata;
      if (currentSessdata === "") {
        setUserInfo(null);
        return;
      }
    } else if (currentSessdata === prevSessdata) {
      return;
    } else {
      // 更新 ref
      prevSessdataRef.current = currentSessdata;
    }

    // sessdata 变为空 -> 登出
    if (prevSessdata !== "" && currentSessdata === "") {
      setUserInfo(null);
      console.log("[ConfigWatch] 已登出，清除用户信息");
      return;
    }

    // sessdata 不为空 -> 获取用户信息
    if (currentSessdata !== "") {
      console.log("[ConfigWatch] SESSDATA 变化，获取用户信息...");

      invoke<UserInfo>("get_user_info", { sessdata: currentSessdata })
        .then((userInfo) => {
          if (userInfo.isLogin ?? userInfo.is_login) {
            const now = new Date();
            const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

            setUserInfo({
              username: userInfo.uname,
              avatar: userInfo.face,
              loginTime: timeStr,
              deviceName: "Windows 桌面端",
            });
            console.log("[ConfigWatch] 获取用户信息成功:", userInfo.uname);
          } else {
            setUserInfo(null);
            console.warn("[ConfigWatch] 用户未登录");
          }
        })
        .catch((err) => {
          console.error("[ConfigWatch] 获取用户信息失败:", err);
          setUserInfo(null);
        });
    }
  }, [config?.sessdata, setUserInfo]);
}
