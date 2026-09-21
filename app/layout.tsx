export const metadata = { title: 'W' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
