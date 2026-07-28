import { getArenaEmailId } from '@/lib/arena-email'
import { ArenaEmailProvider } from '@/components/arena-email-provider'
import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Article Enhancer Agent',
  description:
    'Paste an article, pick a content type, and watch an AI agent enhance it live with streaming Markdown output.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const emailId = await getArenaEmailId()

  return (
    <html lang="en">
      <body className={`${poppins.variable} ${poppins.className} bg-surface font-sans text-ink antialiased`}>
        <ArenaEmailProvider emailId={emailId}>{children}</ArenaEmailProvider>
      </body>
    </html>
  )
}
