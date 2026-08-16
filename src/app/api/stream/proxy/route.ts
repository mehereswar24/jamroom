import { NextRequest, NextResponse } from 'next/server';

// Services whose catalogue is protected by Widevine/PlayReady/FairPlay DRM and
// whose pages also refuse to be framed. There is no way to play these inside
// JamRoom — the licence handshake is bound to their own player and account.
const DRM_HOSTS: Record<string, string> = {
  'hotstar.com': 'JioHotstar',
  'netflix.com': 'Netflix',
  'primevideo.com': 'Prime Video',
  'amazon.com': 'Prime Video',
  'jiocinema.com': 'JioCinema',
  'zee5.com': 'ZEE5',
  'sonyliv.com': 'SonyLIV',
  'disneyplus.com': 'Disney+',
  'hbomax.com': 'HBO Max',
  'max.com': 'Max',
  'apple.com': 'Apple TV+'
};

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Not a valid URL' }, { status: 400 });
  }

  const drmMatch = Object.keys(DRM_HOSTS).find(h => host === h || host.endsWith(`.${h}`));
  if (drmMatch) {
    const service = DRM_HOSTS[drmMatch];
    return NextResponse.json(
      {
        error: 'drm_protected',
        service,
        message: `${service} is DRM-protected and blocks embedding, so it cannot play inside JamRoom. Start it in your own ${service} tab and use JamRoom to stay in sync.`
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    title: 'Web Video Stream',
    streamUrl: url,
    type: 'video'
  });
}
