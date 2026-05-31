import { forwardRef, type HTMLAttributes } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  circle?: boolean;
  width?: string | number;
  height?: string | number;
}

const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className = '', circle = false, width, height, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`shimmer ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
        style={{
          width: width ?? (height ? height : '100%'),
          height: height ?? (width ? width : '1em'),
          ...style,
        }}
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

export default Skeleton;
