import React from 'react';
import { Smartphone, Laptop, Monitor, Tablet, ShieldCheck } from 'lucide-react';

interface DeviceImageProps {
  deviceType?: 'phone' | 'tablet' | 'laptop' | 'desktop' | string;
  deviceImage?: 'android-phone' | 'iphone' | 'macbook' | 'imac' | 'windows-pc' | string;
  size?: number;
  isOnline?: boolean;
  isPermanentSynced?: boolean;
  className?: string;
}

export const DeviceImage: React.FC<DeviceImageProps> = ({
  deviceType = 'phone',
  deviceImage = 'android-phone',
  size = 48,
  isOnline = true,
  isPermanentSynced = true,
  className = '',
}) => {
  const isMobile = deviceType === 'phone' || deviceImage.includes('phone') || deviceImage.includes('iphone');
  const isTablet = deviceType === 'tablet' || deviceImage.includes('tablet') || deviceImage.includes('ipad');

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      {isMobile ? (
        // Smartphone visual representation
        <div
          className="relative rounded-[12px] bg-[#141424] border-2 border-cyan-400/40 shadow-lg shadow-cyan-500/10 flex flex-col items-center justify-between p-1 overflow-hidden"
          style={{ width: size * 0.6, height: size * 0.95 }}
        >
          {/* Punch-hole camera dot */}
          <div className="w-1.5 h-1.5 rounded-full bg-black mt-0.5" />

          {/* Screen Content */}
          <div className="flex-1 w-full rounded-[6px] bg-gradient-to-b from-cyan-950/40 to-black/60 flex items-center justify-center my-0.5">
            <Smartphone size={size * 0.38} className="text-cyan-400" />
          </div>

          {/* Home indicator bar */}
          <div className="w-3.5 h-0.5 rounded-full bg-white/40 mb-0.5" />
        </div>
      ) : isTablet ? (
        // Tablet visual representation
        <div
          className="relative rounded-[10px] bg-[#141424] border-2 border-cyan-400/40 shadow-lg shadow-cyan-500/10 flex items-center justify-center p-1"
          style={{ width: size * 0.85, height: size * 0.95 }}
        >
          <Tablet size={size * 0.45} className="text-cyan-400" />
        </div>
      ) : (
        // Laptop / MacBook visual representation
        <div
          className="relative flex flex-col items-center justify-center"
          style={{ width: size, height: size * 0.8 }}
        >
          {/* Screen Bezel */}
          <div
            className="rounded-t-[6px] bg-[#1C1C28] border border-cyan-400/30 flex items-center justify-center p-1"
            style={{ width: size * 0.82, height: size * 0.52 }}
          >
            <div className="w-full h-full bg-gradient-to-tr from-cyan-950/30 to-black rounded-[3px] flex items-center justify-center">
              <Laptop size={size * 0.3} className="text-cyan-400" />
            </div>
          </div>
          {/* Base */}
          <div
            className="rounded-b-[4px] bg-[#2A2A38] border-t border-white/20 shadow-md"
            style={{ width: size * 0.96, height: size * 0.08 }}
          />
        </div>
      )}

      {/* Online & Permanent Sync Badge */}
      <div className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-[#0D0D1A]">
        <div
          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-black border border-black ${
            isPermanentSynced
              ? 'bg-cyan-400 text-black shadow-[0_0_8px_rgba(0,229,255,0.7)]'
              : isOnline
              ? 'bg-emerald-400 text-black shadow-[0_0_8px_rgba(16,185,129,0.7)]'
              : 'bg-white/20 text-white/50'
          }`}
          title={isPermanentSynced ? 'Permanent Sync Authenticated' : isOnline ? 'Online' : 'Offline'}
        >
          {isPermanentSynced ? '✓' : ''}
        </div>
      </div>
    </div>
  );
};

export default DeviceImage;
