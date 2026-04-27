import { useEffect, useState } from 'react';
import { isAuthenticated, clearApiConfigCache } from '../config/api';

export function AuthCheck({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    // Clear any cached config to get fresh auth status
    clearApiConfigCache();

    // Check authentication via manifest endpoint
    // The manifest will tell us if the HttpOnly cookie is valid
    const checkAuth = async () => {
      try {
        const authenticated = await isAuthenticated();
        setAuthState(authenticated ? 'authenticated' : 'unauthenticated');
      } catch (error) {
        console.error('Auth check failed:', error);
        setAuthState('unauthenticated');
      }
    };

    checkAuth();
  }, []);

  // Show loading state while checking auth
  if (authState === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Checking authentication...</div>
      </div>
    );
  }

  // Show login link if not authenticated
  if (authState === 'unauthenticated') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-4">Authentication Required</h2>
          <p className="mb-4">Please log in to access this page.</p>
          <a
            href="/users/sign_in"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Log In
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
