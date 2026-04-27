import { ThemeToggle } from '@/components/ThemeToggle';
import { LegalLinks } from '@/components/LegalLinks';

interface AppFooterProps {
  appVersion: string;
  appRevision: string;
}

export function AppFooter({ appVersion, appRevision }: AppFooterProps) {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {appVersion && (
              <span className="text-muted-foreground/50">
                v{appVersion}{appRevision && `.${appRevision}`} beta
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <LegalLinks />
            <span>&copy; {new Date().getFullYear()} Revdoku</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
