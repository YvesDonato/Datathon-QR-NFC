import { Workshops } from './workshops';

// Proposed §13 additions: workshop analytics (organizers; the layout checks the role).
export default async function WorkshopsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Workshops slug={slug} />;
}
