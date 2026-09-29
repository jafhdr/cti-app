'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, OverlayClose } from '@/components/ui/overlay';

type Option = { readonly id: string; readonly label: string };
type Props = { readonly label: string; readonly options: readonly Option[]; readonly value: string; readonly onChange: (value: string) => void };

export function EntityPickerDialog({ label, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = options.find(option => option.id === value);

  function onOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.indexOf(event.currentTarget);
    const next = event.key === 'ArrowDown' ? buttons[index + 1] : buttons[index - 1];
    if (next) { event.preventDefault(); next.focus(); }
  }

  return <>
    <Button type="button" view="outlined" onClick={() => { setQuery(''); setOpen(true); }}>{selected?.label ?? label}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="cti-case-picker" initialFocusRef={searchRef}>
        <DialogHeader><DialogTitle>{label}</DialogTitle><OverlayClose /></DialogHeader>
        <DialogBody>
          <input ref={searchRef} className="cti-entity-search" aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}...`} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); listRef.current?.querySelector('button')?.focus(); } }} />
          <div ref={listRef} className="cti-entity-options">
            {visible.length === 0 ? <p>No matching records.</p> : visible.map(option => <button key={option.id} type="button" className="cti-entity-option" aria-pressed={option.id === value} onKeyDown={onOptionKeyDown} onClick={() => { onChange(option.id); setOpen(false); }}>{option.label}</button>)}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  </>;
}
