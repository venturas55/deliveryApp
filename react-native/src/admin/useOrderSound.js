import { useCallback, useEffect, useRef, useState } from "react";

// Keep playback in the navigator so filters and screen changes do not reset it.
export default function useOrderSound(enabled) {
  const controls = useRef(null);
  const [error, setError] = useState("");
  const notify = useCallback(count => controls.current?.notify(count), []);

  useEffect(() => {
    let disposed = false, ready = false, pending = 0, busy = false, started = false;
    setError("");
    if (!enabled) {
      controls.current = null;
      return;
    }
    let player, setAudioModeAsync;
    try {
      // Native audio is optional. Old development clients must still open.
      const audio = require("expo-audio");
      setAudioModeAsync = audio.setAudioModeAsync;
      player = audio.createAudioPlayer(require("../../assets/order-notification.wav"));
    } catch (failure) {
      setError("Sonido no disponible. Reconstruye e instala la app con expo-audio.");
      return;
    }
    async function drain() {
      if (disposed || !ready || busy || !pending || !player.isLoaded) return;
      busy = true;
      started = false;
      pending--;
      try {
        await player.seekTo(0);
        if (disposed) return;
        started = true;
        player.play();
        setError("");
      } catch (failure) {
        busy = false;
        pending = 0;
        if (!disposed) setError(failure.message || "No se pudo reproducir el aviso.");
      }
    }
    controls.current = { notify(count) { pending += count; drain(); } };
    const listener = player.addListener("playbackStatusUpdate", status => {
      if (status.didJustFinish && started) {
        busy = false;
        started = false;
      }
      drain();
    });
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" })
      .then(() => { ready = true; drain(); })
      .catch(failure => { if (!disposed) setError(failure.message); });
    return () => {
      disposed = true;
      controls.current = null;
      listener.remove();
      player.pause();
      player.remove();
    };
  }, [enabled]);

  return { notify, error };
}
