import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

// One queued sound per order; navigation does not reset this hook.
export default function useOrderSound(enabled) {
  const controls = useRef(null);
  const [error, setError] = useState("");
  const notify = useCallback(count => controls.current?.notify(count), []);

  useEffect(() => {
    let disposed = false, pending = 0, retries = 0;
    let active = null, retryTimer = null;
    setError("");
    controls.current = null;
    if (!enabled) return;

    let audio;
    try {
      // Missing native audio must not prevent CLIENT or ADMIN from opening.
      audio = require("expo-audio");
    } catch {
      setError("Sonido no disponible. Reconstruye e instala la app con expo-audio.");
      return;
    }

    function release(run) {
      clearTimeout(run.timer);
      run.listener?.remove();
      try { run.player?.pause(); } catch {}
      try { run.player?.remove(); } catch {}
      if (active === run) active = null;
    }

    function finish(run) {
      if (disposed || active !== run || !run.started) return;
      release(run);
      pending--;
      retries = 0;
      setError("");
      drain();
    }

    function fail(run, failure) {
      if (disposed || active !== run) return;
      release(run);
      retries++;
      setError(failure.message || "No se pudo reproducir el aviso.");
      // Keep every pending order. Retry transient failures without an endless loop.
      if (retries < 3) retryTimer = setTimeout(() => {
        retryTimer = null;
        drain();
      }, 1000);
    }

    function start(run) {
      if (disposed || active !== run || run.started || !run.player.isLoaded) return;
      clearTimeout(run.timer);
      try {
        run.started = true;
        run.player.play();
        if (disposed || active !== run) return;
        const duration = Number(run.player.duration);
        run.timer = setTimeout(() => {
          if (disposed || active !== run) return;
          // Recover a lost completion event only if playback actually reached the end.
          if (duration > 0 && run.player.currentTime >= duration - 0.05) finish(run);
          else fail(run, new Error("Aviso interrumpido. Reintentando sonido."));
        }, Number.isFinite(duration) && duration > 0 ? duration * 1000 + 1500 : 10000);
      } catch (failure) { fail(run, failure); }
    }

    async function drain() {
      if (disposed || active || retryTimer || !pending || AppState.currentState !== "active") return;
      const run = { player: null, listener: null, timer: null, started: false };
      active = run;
      try {
        // Reassert audio mode after phone calls or returning from another app.
        await audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" });
        if (disposed || active !== run) return;
        // A fresh player avoids reusing a completed or interrupted native player.
        run.player = audio.createAudioPlayer(require("../../assets/order-notification.wav"));
        run.player.volume = 1;
        run.timer = setTimeout(() => fail(run, new Error("No se pudo cargar el sonido del aviso.")), 10000);
        run.listener = run.player.addListener("playbackStatusUpdate", status => {
          if (disposed || active !== run) return;
          const reachedEnd = status.playing === false && status.duration > 0 &&
            status.currentTime >= status.duration;
          if (run.started && (status.didJustFinish || reachedEnd)) finish(run);
          else start(run);
        });
        start(run);
      } catch (failure) { fail(run, failure); }
    }

    controls.current = { notify(count) {
      if (disposed || !Number.isInteger(count) || count < 1) return;
      pending += count;
      if (!active && !retryTimer) retries = 0;
      drain();
    } };
    const appState = AppState.addEventListener("change", state => {
      if (state !== "active") {
        clearTimeout(retryTimer);
        retryTimer = null;
        if (active) release(active);
      } else {
        retries = 0;
        drain();
      }
    });
    return () => {
      disposed = true;
      controls.current = null;
      clearTimeout(retryTimer);
      appState.remove();
      if (active) release(active);
    };
  }, [enabled]);

  return { notify, error };
}
