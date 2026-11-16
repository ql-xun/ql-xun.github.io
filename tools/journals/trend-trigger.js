// Mouse hover is transient; a touch press toggles the same chart.
export function bindTrendTrigger(control, { open, close, isOpen }) {
  let pointer = "";
  const dismiss = () => { if (isOpen()) close(); };
  control.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") open(); });
  control.addEventListener("pointerleave", event => { if (event.pointerType === "mouse") dismiss(); });
  control.addEventListener("pointerdown", event => { pointer = event.pointerType; });
  control.addEventListener("pointercancel", () => { pointer = ""; });
  control.addEventListener("focus", () => {
    if (!["touch", "pen"].includes(pointer) && control.matches(":focus-visible")) open();
  });
  control.addEventListener("blur", () => { pointer = ""; dismiss(); });
  control.addEventListener("click", event => {
    const device = pointer || event.pointerType;
    pointer = "";
    if (event.detail === 0) open(); // Keyboard and assistive technology.
    else if (["touch", "pen"].includes(device)) {
      if (isOpen()) close();
      else open();
    }
  });
}
