import './globals.css';
import './soc-theme.css';
import './editorial.css';
import './reference-ux.css';
import './dashboard-visual.css';
import { ThemeProvider } from '../components/ThemeProvider';
import '../components/ui/overlay.css';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="dark" suppressHydrationWarning>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
