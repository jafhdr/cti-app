'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type OverlayContextValue = { open: boolean; close: () => void; titleId: string; descriptionId: string; closeOnBackdropClick: boolean; closeOnEscape: boolean };
const OverlayContext = createContext<OverlayContextValue | null>(null);
const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
let locks = 0;
let savedOverflow = '';
const backgroundStates = new Map<HTMLElement, boolean>();

function useOverlay() {
  const context = useContext(OverlayContext);
  if (!context) throw new Error('Overlay parts must be inside Dialog or Drawer');
  return context;
}

type RootProps = { open: boolean; onOpenChange: (open: boolean) => void; closeOnBackdropClick?: boolean; closeOnEscape?: boolean; children: ReactNode };
function OverlayRoot({ open, onOpenChange, closeOnBackdropClick = true, closeOnEscape = true, children }: RootProps) {
  const titleId = useId();
  const descriptionId = useId();
  return <OverlayContext.Provider value={{ open, close: () => onOpenChange(false), titleId, descriptionId, closeOnBackdropClick, closeOnEscape }}>{children}</OverlayContext.Provider>;
}

type ContentProps = { children: ReactNode; className?: string; 'aria-label'?: string; describedBy?: boolean; initialFocusRef?: React.RefObject<HTMLElement | null> };
function OverlayContent({ children, className = '', 'aria-label': ariaLabel, describedBy = false, initialFocusRef, kind }: ContentProps & { kind: 'dialog' | 'drawer' }) {
  const { open, close, titleId, descriptionId, closeOnBackdropClick, closeOnEscape } = useOverlay();
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open || !mounted) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (locks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      for (const child of Array.from(document.body.children)) {
        if (child instanceof HTMLElement && !child.classList.contains('cti-overlay')) {
          backgroundStates.set(child, child.inert);
          child.inert = true;
        }
      }
    }
    const frame = requestAnimationFrame(() => (initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(focusableSelector) ?? panelRef.current)?.focus());
    const keepFocus = (event: FocusEvent) => {
      if (panelRef.current && event.target instanceof Node && !panelRef.current.contains(event.target)) {
        (panelRef.current.querySelector<HTMLElement>(focusableSelector) ?? panelRef.current).focus();
      }
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', keepFocus);
      if (--locks === 0) {
        document.body.style.overflow = savedOverflow;
        for (const [element, previous] of backgroundStates) element.inert = previous;
        backgroundStates.clear();
      }
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [open, mounted, initialFocusRef]);
  if (!mounted || !open) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (closeOnEscape) { event.preventDefault(); close(); } return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(item => item.getClientRects().length > 0);
    if (!items.length) { event.preventDefault(); panelRef.current?.focus(); return; }
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { event.preventDefault(); first.focus(); }
  };
  return createPortal(<div className={`cti-overlay cti-overlay--${kind}`} onMouseDown={event => { if (closeOnBackdropClick && event.target === event.currentTarget) close(); }}>
    <section ref={panelRef} className={`cti-overlay-panel ${className}`} role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : titleId} aria-describedby={describedBy ? descriptionId : undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      {children}
    </section>
  </div>, document.body);
}

export function Dialog(props: RootProps) { return <OverlayRoot {...props} />; }
export function Drawer(props: RootProps) { return <OverlayRoot {...props} />; }
export function DialogContent(props: ContentProps) { return <OverlayContent {...props} kind="dialog" />; }
export function DrawerContent(props: ContentProps) { return <OverlayContent {...props} kind="drawer" />; }
export function DialogHeader({ children }: { children: ReactNode }) { return <header className="cti-overlay-header">{children}</header>; }
export const DrawerHeader = DialogHeader;
export function DialogTitle({ children }: { children: ReactNode }) { const { titleId } = useOverlay(); return <h2 id={titleId} className="cti-overlay-title">{children}</h2>; }
export const DrawerTitle = DialogTitle;
export function DialogDescription({ children }: { children: ReactNode }) { const { descriptionId } = useOverlay(); return <p id={descriptionId} className="cti-overlay-description">{children}</p>; }
export const DrawerDescription = DialogDescription;
export function DialogBody({ children }: { children: ReactNode }) { return <div className="cti-overlay-body">{children}</div>; }
export const DrawerBody = DialogBody;
export function DialogFooter({ children }: { children: ReactNode }) { return <footer className="cti-overlay-footer">{children}</footer>; }
export const DrawerFooter = DialogFooter;
export function OverlayClose({ label = 'Close', disabled = false }: { label?: string; disabled?: boolean }) { const { close } = useOverlay(); return <button type="button" className="cti-overlay-close" aria-label={label} disabled={disabled} onClick={close}><X size={18} /></button>; }
