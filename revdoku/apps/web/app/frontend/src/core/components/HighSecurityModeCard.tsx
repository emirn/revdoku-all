// Core edition has no High Security Mode / HIPAA surface — the security
// settings page hides this card entirely.

interface HighSecurityModeCardProps {
  isHighSecurity: boolean;
  isHipaa: boolean;
}

export function HighSecurityModeCard(_props: HighSecurityModeCardProps) {
  return null;
}
