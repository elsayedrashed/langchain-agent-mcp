'use client';
import { useEffect } from 'react';
import useIsAtBottom from '@/hooks/use-is-at-bottom';
import { useInView } from 'react-intersection-observer';

type AutoScrollProps = {
  trackVisibility: boolean;
};

const AutoScroll = ({ trackVisibility }: AutoScrollProps) => {
  const isAtBottom = useIsAtBottom();
  const { ref, entry, inView } = useInView({
    trackVisibility,
    delay: 100,
    rootMargin: '0px 0px -150px 0px',
  });
  useEffect(() => {
    if (isAtBottom && trackVisibility && !inView) {
      entry?.target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [inView, entry, isAtBottom, trackVisibility]);

  return <div ref={ref} className="h-px w-full" />;
};

export default AutoScroll;
