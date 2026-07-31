import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";

/**
 * 在界面预览中根据本地演示状态同步用户信息。
 */
export function useConfigWatch() {
  const config = useAppStore((state) => state.config);
  const setUserInfo = useAppStore((state) => state.setUserInfo);

  useEffect(() => {
    if (!config?.sessdata) {
      setUserInfo(null);
      return;
    }

    setUserInfo({
      username: "BiliBox Demo",
      avatar: "/demo-avatar.svg",
      loginTime: "--",
      deviceName: "本地界面预览",
    });
  }, [config?.sessdata, setUserInfo]);
}
