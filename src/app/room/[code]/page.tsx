import RoomShell from '@/components/room/RoomShell';

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    return <RoomShell roomCode={code.toUpperCase()} />;
}
