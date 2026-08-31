import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CardProps = HTMLAttributes<HTMLDivElement> & { readonly view?: 'outlined' };

export function Card({ className, ...props }: CardProps) { return <div className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />; }
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />; }
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('p-5 pt-0', className)} {...props} />; }
