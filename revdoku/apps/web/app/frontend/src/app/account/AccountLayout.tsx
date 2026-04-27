import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { User, Users, Shield, Sparkles, KeyRound } from 'lucide-react';
import AccountProfilePage from './profile/page';
import AccountSecurityPage from './security/page';
import AccountMembersPage from './members/page';
import AccountApiPage from './api/page';
import AccountAiPage from './ai/page';
import { extraAccountTabs } from '@ee/app/account/tabs';

// Base tabs render in every build. Extra tabs come from the @ee overlay
// (or a stub empty array when the overlay isn't present in this build).
const BASE_TABS = [
  { value: 'profile',  path: '/account/profile',  label: 'Profile',  Icon: User,     Page: AccountProfilePage },
  { value: 'members',  path: '/account/members',  label: 'Account',  Icon: Users,    Page: AccountMembersPage },
  { value: 'security', path: '/account/security', label: 'Security', Icon: Shield,   Page: AccountSecurityPage },
  { value: 'ai',       path: '/account/ai',       label: 'AI',       Icon: Sparkles, Page: AccountAiPage },
  { value: 'api',      path: '/account/api',      label: 'API',      Icon: KeyRound, Page: AccountApiPage },
];

// Render order — base tabs interleaved with any extra tabs from @ee so
// Subscription slots between Profile and Account.
const TAB_ORDER = [
  'profile',
  'subscription',
  'members',
  'security',
  'ai',
  'api',
];

const ALL_TABS = [...BASE_TABS, ...extraAccountTabs].sort(
  (a, b) => TAB_ORDER.indexOf(a.value) - TAB_ORDER.indexOf(b.value)
);

function pathToTab(pathname: string): string {
  const match = ALL_TABS.find(t => pathname.startsWith(t.path));
  return match?.value ?? 'profile';
}

export default function AccountLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = pathToTab(location.pathname);

  const handleTabChange = (value: string) => {
    const tab = ALL_TABS.find(t => t.value === value);
    if (tab && tab.path !== location.pathname) {
      navigate(tab.path);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Account Settings</h1>
        <p className="text-muted-foreground">Manage your profile, subscription, and team</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {ALL_TABS.map(tab => {
            const Icon = tab.Icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                <span className="inline-flex items-center gap-1.5">
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {tab.label}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {ALL_TABS.map(tab => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.Page />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
