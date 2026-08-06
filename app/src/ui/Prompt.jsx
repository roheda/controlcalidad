import React, { useCallback, useMemo, useState } from "react";
import Modal from "./Modal.jsx";
import Button from "./Button.jsx";
import { Input, Textarea } from "./Field.jsx";
import { PromptContext } from "./PromptContext.js";

export function PromptProvider({ children }) {
  const [state, setState] = useState(null);

  const close = useCallback((value) => {
    setState((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const confirm = useCallback(({ title = "Confirmar", message, confirmLabel = "Confirmar", cancelLabel = "Cancelar", tone = "primary" } = {}) => {
    return new Promise((resolve) => {
      setState({ kind: "confirm", title, message, confirmLabel, cancelLabel, tone, resolve });
    });
  }, []);

  const prompt = useCallback(({ title = "Captura un valor", label, message, defaultValue = "", placeholder = "", type = "text", confirmLabel = "Guardar", cancelLabel = "Cancelar", multiline = false } = {}) => {
    return new Promise((resolve) => {
      setState({ kind: "prompt", title, label, message, value: defaultValue, placeholder, type, confirmLabel, cancelLabel, multiline, resolve });
    });
  }, []);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <PromptContext.Provider value={value}>
      {children}
      <Modal open={!!state} onClose={() => close(state?.kind === "confirm" ? false : null)} title={state?.title} width={440}>
        {state?.kind === "confirm" ? (
          <>
            {state.message ? <p className="text-sm text-ink-muted">{state.message}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>{state.cancelLabel}</Button>
              <Button variant={state.tone} onClick={() => close(true)}>{state.confirmLabel}</Button>
            </div>
          </>
        ) : null}
        {state?.kind === "prompt" ? (
          <form
            onSubmit={(event) => { event.preventDefault(); close(state.value); }}
          >
            {state.message ? <p className="mb-3 text-sm text-ink-muted">{state.message}</p> : null}
            {state.multiline ? (
              <Textarea
                autoFocus
                label={state.label}
                placeholder={state.placeholder}
                value={state.value}
                onChange={(event) => setState((current) => ({ ...current, value: event.target.value }))}
              />
            ) : (
              <Input
                autoFocus
                type={state.type}
                label={state.label}
                placeholder={state.placeholder}
                value={state.value}
                onChange={(event) => setState((current) => ({ ...current, value: event.target.value }))}
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => close(null)}>{state.cancelLabel}</Button>
              <Button type="submit">{state.confirmLabel}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </PromptContext.Provider>
  );
}
