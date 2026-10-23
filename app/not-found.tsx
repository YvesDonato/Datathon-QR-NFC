import Link from 'next/link';

// Next's built-in 404 paints its own white/black body; this one keeps the app's theme.
export default function NotFound() {
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '32px 16px' }}>
      <h1>Page not found</h1>
      <p>This link doesn’t go anywhere. Check it, or start again from your menu.</p>
      <Link href="/">Home</Link>
    </main>
  );
}
