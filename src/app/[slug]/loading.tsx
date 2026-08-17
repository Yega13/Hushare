import AlbumSkeleton from '@/components/AlbumSkeleton'
import StaleDeployWatchdog from '@/components/StaleDeployWatchdog'

export default function Loading() {
  return (
    <>
      <AlbumSkeleton />
      {/* Turns "this album never opens" into a single automatic reload. See the component. */}
      <StaleDeployWatchdog />
    </>
  )
}
