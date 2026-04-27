import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';

const EnvelopePageContent = lazy(() => import('@/components/envelope-page/EnvelopePage'));

export default function EnvelopeViewPage() {
  const [searchParams] = useSearchParams();
  const envelopeId = searchParams.get('id') || searchParams.get('envelopeId');

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <Suspense fallback={
        <div className="flex items-center justify-center flex-1">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      }>
        <EnvelopePageContent key={envelopeId} />
      </Suspense>
    </div>
  );
}
