const TEXT_ENTRY_TAGS = new Set(["input", "textarea", "select"]);
const ACTIVATION_TAGS = new Set(["button", "a"]);

type ShortcutElement = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

function shortcutElement(target: EventTarget | null): ShortcutElement | null {
  return target && typeof target === "object" ? target as ShortcutElement : null;
}

/** Text entry and modal UI must block every global gameplay shortcut. */
export function blocksGameplayKeys(target: EventTarget | null): boolean {
  const element = shortcutElement(target);
  if (!element) return false;
  if (element.tagName && TEXT_ENTRY_TAGS.has(element.tagName.toLowerCase())) return true;
  if (element.isContentEditable) return true;
  return Boolean(element.closest?.('[contenteditable="true"], [role="dialog"], [aria-modal="true"], [data-shortcuts="off"]'));
}

/** Space/Enter belong to the focused native action instead of the simulation. */
export function isNativeActivationTarget(target: EventTarget | null): boolean {
  const element = shortcutElement(target);
  return Boolean(element?.tagName && ACTIVATION_TAGS.has(element.tagName.toLowerCase()));
}
