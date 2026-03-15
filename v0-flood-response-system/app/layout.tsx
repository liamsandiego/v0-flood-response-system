import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'RapidRelay – PAGASA Obando Flood Response',
  description:
    'Real-time flood monitoring and early warning system deployed at PAGASA – Obando, Bulacan near the dike/flood gate. Monitors water level, soil moisture, and humidity.',
  generator: 'Next.js',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'RapidRelay',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192x192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className={`font-sans antialiased`}>
        {children}
        <Analytics />
        {/* Register service worker — production only to avoid stale cache in dev */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
                  // Dev mode: unregister any existing SW to avoid stale cache issues
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    regs.forEach(function(r) { r.unregister(); console.log('[SW] Unregistered dev SW'); });
                  });
                  // Also clear caches
                  caches.keys().then(function(names) {
                    names.forEach(function(name) { caches.delete(name); });
                    if (names.length) console.log('[SW] Cleared stale caches:', names);
                  });
                } else {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js').then(
                      function(reg) { console.log('[SW] Registered:', reg.scope); },
                      function(err) { console.warn('[SW] Registration failed:', err); }
                    );
                  });
                }
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
