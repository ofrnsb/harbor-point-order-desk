"use client";
import { COMPOSER_LIMITS } from "@/config/ui";
import { COMPOSER } from "@/copy/ui-chat";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, memo, useEffect, useRef, useState } from "react";
import { IArrowUp, ICheck, IChevron, ISpark, IStop } from "./icons";
import { D, EASE, FADE } from "./motion";

export const MODEL_INFO = COMPOSER.models;
export type ModelId = keyof typeof MODEL_INFO;


type Props = {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  model: ModelId;
  onModel: (m: ModelId) => void;
  /** When set, an admin route fixes the model and the picker is hidden. */
  routeLabel?: string;
};

export const Composer = memo(forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { placeholder, value, onChange, onSend, onStop, streaming, model, onModel, routeLabel },
  ref,
) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = inner.current;
    if (!ta) return;
    // Measure at auto, then glide from the old height to the new one instead of jumping a line at a time.
    const from = ta.offsetHeight;
    ta.style.height = "auto";
    const to = Math.min(ta.scrollHeight, COMPOSER_LIMITS.maxHeightPx);
    ta.style.height = `${from}px`;
    void ta.offsetHeight;
    ta.style.height = `${to}px`;
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const canSend = value.trim().length > 0 && !streaming;
  const nearLimit = value.length >= COMPOSER_LIMITS.nearChars;

  return (
    <motion.div
      className="ap-composer"
      data-streaming={streaming}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: D.d4, ease: EASE }}
      data-guard="visible"
      data-guard-label={COMPOSER.guard}
    >
      <label htmlFor="ap-input" className="ap-sr">{COMPOSER.messageLabel}</label>
      <textarea
        id="ap-input"
        dir="auto"
        rows={1}
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        maxLength={COMPOSER_LIMITS.maxChars}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
          if (e.key === "Escape" && streaming) {
            e.preventDefault();
            onStop();
          }
        }}
      />
      <div className="ap-composer-row">
        {!routeLabel && (
        <div className="ap-model" ref={pop}>
          <button
            type="button"
            className="ap-model-btn"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={COMPOSER.modelTitle(MODEL_INFO[model].name)}
            onClick={() => setOpen((o) => !o)}
          >
            <ISpark size={12} className="ap-model-spark" />
            <span>{MODEL_INFO[model].name}</span>
            <IChevron size={13} className="ap-model-chev" />
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                className="ap-pop"
                role="menu"
                aria-label={COMPOSER.chooseModel}
                initial={{ opacity: 0, scale: 0.96, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 4, transition: { duration: D.d1, ease: EASE } }}
                transition={{ duration: D.d2, ease: EASE }}
              >
                {(Object.keys(MODEL_INFO) as ModelId[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={m === model}
                    className="ap-pop-item"
                    onClick={() => {
                      onModel(m);
                      setOpen(false);
                    }}
                  >
                    <span className="ap-pop-check">{m === model && <ICheck size={15} />}</span>
                    <span className="ap-pop-copy">
                      <strong>{MODEL_INFO[m].name}</strong>
                      <span>{MODEL_INFO[m].hint}</span>
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}

        <div className="ap-composer-end">
          <AnimatePresence initial={false}>
            {nearLimit && (
              <motion.span key="count" className="ap-char-count ap-num" data-warn={value.length >= COMPOSER_LIMITS.warnChars} {...FADE}>
                {value.length}/{COMPOSER_LIMITS.maxChars}
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="button"
            className="ap-send"
            data-stop={streaming}
            disabled={!streaming && !canSend}
            onClick={streaming ? onStop : onSend}
            aria-label={streaming ? COMPOSER.stop : COMPOSER.send}
            data-guard="clickable"
            data-guard-label={COMPOSER.sendGuard}
          >
            <span className="ap-send-ico" data-ico="send" aria-hidden><IArrowUp size={17} /></span>
            <span className="ap-send-ico" data-ico="stop" aria-hidden><IStop size={15} /></span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}));
