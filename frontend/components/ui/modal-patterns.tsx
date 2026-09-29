'use client';

import { type FormEvent, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, OverlayClose } from './overlay';

type Common = { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; loading?: boolean; error?: string | null; cancelLabel?: string; closeOnBackdropClick?: boolean; closeOnEscape?: boolean };
export type FormModalProps = Common & { children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string; submitDisabled?: boolean };
export function FormModal({ open, onOpenChange, title, description, loading = false, error, cancelLabel = 'Cancel', submitLabel = 'Save', submitDisabled = false, closeOnBackdropClick = true, closeOnEscape = true, onSubmit, children }: FormModalProps) {
  return <Dialog open={open} onOpenChange={onOpenChange} closeOnBackdropClick={!loading && closeOnBackdropClick} closeOnEscape={!loading && closeOnEscape}>
    <DialogContent describedBy={!!description}>
      <DialogHeader><div><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</div><OverlayClose disabled={loading} /></DialogHeader>
      <form className="cti-overlay-form" onSubmit={onSubmit}>
        <DialogBody>{children}{error && <p className="cti-overlay-error" role="alert">{error}</p>}</DialogBody>
        <DialogFooter><Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>{cancelLabel}</Button><Button type="submit" disabled={loading || submitDisabled}>{loading ? 'Saving…' : submitLabel}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export type ConfirmationModalProps = Common & { target?: string; consequence?: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void | Promise<void> };
export function ConfirmationModal({ open, onOpenChange, title, description, target, consequence, confirmLabel, destructive = false, loading = false, error, cancelLabel = 'Cancel', closeOnBackdropClick, closeOnEscape = true, onConfirm }: ConfirmationModalProps) {
  return <Dialog open={open} onOpenChange={onOpenChange} closeOnBackdropClick={!loading && (closeOnBackdropClick ?? !destructive)} closeOnEscape={!loading && closeOnEscape}>
    <DialogContent describedBy={!!description || !!consequence}>
      <DialogHeader><div><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</div><OverlayClose disabled={loading} /></DialogHeader>
      <DialogBody>{target && <p className="cti-overlay-target">{target}</p>}{consequence && (description ? <p>{consequence}</p> : <DialogDescription>{consequence}</DialogDescription>)}{error && <p className="cti-overlay-error" role="alert">{error}</p>}</DialogBody>
      <DialogFooter><Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>{cancelLabel}</Button><Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={loading} onClick={() => void onConfirm()}>{loading ? 'Working…' : confirmLabel}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
