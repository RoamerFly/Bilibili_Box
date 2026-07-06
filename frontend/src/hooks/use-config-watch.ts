import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { invoke } from "@/lib/api";

interface UserInfo {
  isLogin?: boolean;
  is_login?: boolean;
  uname: string;
  mid: number;
  face: string;
  login_time?: string | null;
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

    // sessdata 不为空 -> 读取当前 profile 下的本地用户信息
    if (currentSessdata !== "") {
      console.log("[ConfigWatch] SESSDATA 变化，读取当前账号信息...");

      const isCurrentSessdata = () =>
        (useAppStore.getState().config?.sessdata || "") === currentSessdata;

      const applyUserInfo = (userInfo: UserInfo, loginTime = userInfo.login_time || "--") => {
        if (!isCurrentSessdata()) return;
        setUserInfo({
          username: userInfo.uname,
          avatar: userInfo.face,
          loginTime,
          deviceName: "Windows 桌面端",
        });
        console.log("[ConfigWatch] 当前账号信息已更新:", userInfo.uname);
      };

      invoke<UserInfo | null>("get_saved_user_info")
        .then((savedUserInfo) => {
          if (savedUserInfo && (savedUserInfo.isLogin ?? savedUserInfo.is_login)) {
            applyUserInfo(savedUserInfo);
            return null;
          }

          return invoke<UserInfo>("get_user_info", { sessdata: currentSessdata });
        })
        .then((userInfo) => {
          if (!userInfo) return;
          if (userInfo.isLogin ?? userInfo.is_login) {
            const now = new Date();
            const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
            applyUserInfo(userInfo, timeStr);
          } else if (isCurrentSessdata()) {
            console.warn("[ConfigWatch] 用户信息不可用，保留当前账号配置");
            setUserInfo(null);
          }
        })
        .catch((err) => {
          console.error("[ConfigWatch] 获取用户信息失败:", err);
          if (isCurrentSessdata()) {
            setUserInfo(null);
          }
        });
    }
  }, [config?.sessdata, setUserInfo]);
}
