import '@gravity-ui/uikit/styles/fonts.css';
import '@gravity-ui/uikit/styles/styles.css';
import './globals.css';

import GravityProvider from '../components/GravityProvider';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <GravityProvider>
          {children}
        </GravityProvider>
      </body>
    </html>
  );
}