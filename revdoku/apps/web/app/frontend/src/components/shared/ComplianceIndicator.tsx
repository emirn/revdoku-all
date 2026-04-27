import React from 'react';

interface ComplianceIndicatorProps {
  value: number;
  totalChecks?: number;
  passedChecks?: number;
  variant?: 'full' | 'compact';
}

export const ComplianceIndicator = React.memo(({ 
  value, 
  totalChecks, 
  passedChecks,
  variant = 'full'
}: ComplianceIndicatorProps) => {
  // Handle edge cases
  const displayValue = isNaN(value) || totalChecks === 0 ? 0 : value;
  const failedChecks = (totalChecks || 0) - (passedChecks || 0);
  
  // Semi-circle gauge calculations
  const radius = variant === 'compact' ? 24 : 32;
  const stroke = variant === 'compact' ? 4 : 5;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * Math.PI; // Half circle
  const strokeDashoffset = circumference - (displayValue / 100) * circumference;
  
  // Color scheme
  const getColor = () => {
    if (totalChecks === 0) return { stroke: '#94a3b8', bg: '#f1f5f9', text: '#64748b' };
    if (displayValue === 100) return { stroke: '#10b981', bg: '#d1fae5', text: '#047857' };
    if (displayValue >= 75) return { stroke: '#22c55e', bg: '#dcfce7', text: '#15803d' };
    if (displayValue >= 50) return { stroke: '#fbbf24', bg: '#fef3c7', text: '#b45309' };
    if (displayValue >= 25) return { stroke: '#fb923c', bg: '#fed7aa', text: '#c2410c' };
    return { stroke: '#ef4444', bg: '#fee2e2', text: '#b91c1c' };
  };
  
  const colors = getColor();
  
  if (variant === 'compact') {
    // Compact version for list view
    return (
      <div className="flex flex-col items-center">
        <div className="relative" style={{ width: radius * 2, height: radius + 6 }}>
          <svg
            width={radius * 2}
            height={radius + 6}
            className="overflow-visible"
          >
            <defs>
              <linearGradient id={`gradient-${displayValue}-${totalChecks}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={colors.stroke} stopOpacity="0.8" />
                <stop offset="100%" stopColor={colors.stroke} stopOpacity="1" />
              </linearGradient>
            </defs>
            
            {/* Background arc */}
            <path
              d={`M ${stroke} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - stroke} ${radius}`}
              fill="none"
              className="stroke-muted"
              strokeWidth={stroke}
              strokeLinecap="round"
            />
            
            {/* Progress arc */}
            <path
              d={`M ${stroke} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - stroke} ${radius}`}
              fill="none"
              stroke={`url(#gradient-${displayValue}-${totalChecks})`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          </svg>
          
          {/* Center value */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
            <div className="text-lg font-bold" style={{ color: colors.text }}>
              {totalChecks === 0 ? '—' : `${displayValue}`}
              {totalChecks !== 0 && <span className="text-[10px] font-normal">%</span>}
            </div>
          </div>
        </div>
        
        {/* Compact stats */}
        {totalChecks !== undefined && totalChecks > 0 && (
          <div className="text-[10px] text-muted-foreground mt-0.5 font-medium">
            {passedChecks}/{totalChecks}
          </div>
        )}
      </div>
    );
  }
  
  // Full version for auto-folders view
  return (
    <div className="flex flex-col items-center p-2">
      {/* Semi-circular gauge */}
      <div className="relative" style={{ width: radius * 2, height: radius + 10 }}>
        <svg
          width={radius * 2}
          height={radius + 10}
          className="overflow-visible"
        >
          <defs>
            <linearGradient id={`gradient-${displayValue}-${totalChecks}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.stroke} stopOpacity="0.8" />
              <stop offset="100%" stopColor={colors.stroke} stopOpacity="1" />
            </linearGradient>
          </defs>
          
          {/* Background arc */}
          <path
            d={`M ${stroke} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - stroke} ${radius}`}
            fill="none"
            className="stroke-muted"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          
          {/* Progress arc */}
          <path
            d={`M ${stroke} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - stroke} ${radius}`}
            fill="none"
            stroke={`url(#gradient-${displayValue}-${totalChecks})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>
        
        {/* Center value */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <div className="text-2xl font-bold" style={{ color: colors.text }}>
            {totalChecks === 0 ? '—' : `${displayValue}`}
            {totalChecks !== 0 && <span className="text-xs font-normal">%</span>}
          </div>
        </div>
      </div>
      
      {/* Mini bar chart */}
      {totalChecks !== undefined && totalChecks > 0 && (
        <div className="w-full mt-3">
          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
            {passedChecks! > 0 && (
              <div 
                className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                style={{ width: `${(passedChecks! / totalChecks) * 100}%` }}
                title={`${passedChecks} passed`}
              />
            )}
            {failedChecks > 0 && (
              <div 
                className="bg-gradient-to-r from-red-400 to-red-500 transition-all duration-500"
                style={{ width: `${(failedChecks / totalChecks) * 100}%` }}
                title={`${failedChecks} failed`}
              />
            )}
          </div>
          <div className="flex justify-between mt-1 text-[10px] font-medium">
            <span className="text-emerald-600 dark:text-emerald-400">{passedChecks} ✓</span>
            <span className="text-muted-foreground">{totalChecks} total</span>
            {failedChecks > 0 && <span className="text-red-600 dark:text-red-400">{failedChecks} ✗</span>}
          </div>
        </div>
      )}
      
      {/* No checks state */}
      {(totalChecks === undefined || totalChecks === 0) && (
        <div className="text-xs text-muted-foreground mt-2 font-medium">No review</div>
      )}
    </div>
  );
});

ComplianceIndicator.displayName = 'ComplianceIndicator';