import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { adminApi } from "./api";

// Poll only mounted screens in foreground. Abort stale reads when navigating.
export default function useAdminData(path, interval = 0) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const controller = useRef(null), generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!path) return;
    controller.current?.abort();
    const request = new AbortController(), current = ++generation.current;
    controller.current = request;
    setLoading(true);
    try {
      const result = await adminApi(path, { signal: request.signal });
      if (current === generation.current) { setData(result); setError(""); }
      return result;
    } catch (failure) {
      if (failure.name !== "AbortError" && current === generation.current) setError(failure.message);
    } finally { if (current === generation.current) setLoading(false); }
  }, [path]);
  useEffect(() => {
    setData(null);
    if (!path) return;
    refresh();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
      else { generation.current++; controller.current?.abort(); setLoading(false); }
    });
    const timer = interval ? setInterval(() => {
      if (AppState.currentState === "active" && !controller.current?.signal.aborted) refresh();
    }, interval) : null;
    return () => { generation.current++; controller.current?.abort(); listener.remove(); if (timer) clearInterval(timer); };
  }, [refresh, interval]);
  return { data, error, loading, refresh };
}
