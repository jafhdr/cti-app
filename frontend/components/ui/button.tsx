import { type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive';
type LegacyView = 'action' | 'outlined' | 'normal' | 'flat' | 'flat-danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly view?: LegacyView;
  readonly size?: 's' | 'm' | 'l';
};

const viewToVariant: Record<LegacyView, ButtonVariant> = {
  action: 'default', outlined: 'outline', normal: 'outline', flat: 'ghost', 'flat-danger': 'destructive',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  s: 'h-8 px-2.5 text-xs', m: 'h-9 px-3 text-sm', l: 'h-10 px-4 text-sm',
};

export function Button({ className, variant, view, size = 'm', ...props }: ButtonProps) {
  const selectedVariant = variant ?? (view ? viewToVariant[view] : 'default');
  const variants: Record<ButtonVariant, string> = {
    default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    outline: 'border border-input bg-background text-foreground shadow-sm hover:bg-accent',
    ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
    destructive: 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
  };
  return <button className={cn('inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', sizeClasses[size], variants[selectedVariant], className)} {...props} />;
}
