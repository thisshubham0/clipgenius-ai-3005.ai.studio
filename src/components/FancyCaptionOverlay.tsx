import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { CaptionLine, CaptionStyle } from '../shared/types';
import {
  type CaptionMotionKind,
  getCaptionStyleMeta,
  normalizeCaptionStyle,
} from '../utils/videoStyles';

interface FancyCaptionOverlayProps {
  line: CaptionLine | null;
  captionStyle: CaptionStyle | string;
  fontFamily: string;
  highlightColor: string;
  compact?: boolean;
  motionTrigger?: number;
}

function splitHighlightedWords(text: string, highlightWords?: string[]) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const explicitSet = new Set(
    (highlightWords || []).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean)
  );

  return tokens.map((token, idx) => {
    const clean = token.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isAutoEmphasis =
      explicitSet.size === 0 &&
      tokens.length >= 3 &&
      (idx === Math.floor(tokens.length / 2) || clean.length >= 7);
    const highlighted = explicitSet.has(clean) || isAutoEmphasis;
    return { token, highlighted, key: `${idx}-${token}` };
  });
}

function getMotionProps(kind: CaptionMotionKind, reducedMotion: boolean) {
  if (reducedMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.12 },
    };
  }

  switch (kind) {
    case 'glow-pop':
      return {
        initial: { opacity: 0, scale: 0.9 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
      };
    case 'slide-up':
      return {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
      };
    case 'bounce':
      return {
        initial: { opacity: 0, scale: 0.85, rotate: -3 },
        animate: { opacity: 1, scale: 1, rotate: -1 },
        transition: { type: 'spring' as const, stiffness: 420, damping: 20 },
      };
    case 'type-reveal':
      return {
        initial: { opacity: 0, x: -6 },
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
      };
    case 'glitch-snap':
      return {
        initial: { opacity: 0, skewX: -8, scale: 1.04 },
        animate: { opacity: 1, skewX: 0, scale: 1 },
        transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
      };
    case 'scale-pop':
      return {
        initial: { opacity: 0, scale: 0.94 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
      };
    case 'sweep':
      return {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.2 },
      };
    case 'fade':
    default:
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2 },
      };
  }
}

export function FancyCaptionOverlay({
  line,
  captionStyle,
  fontFamily,
  highlightColor,
  compact = false,
  motionTrigger = 0,
}: FancyCaptionOverlayProps) {
  const prefersReducedMotion = Boolean(useReducedMotion());

  if (!line || !line.text.trim()) return null;

  const style = normalizeCaptionStyle(captionStyle);
  const meta = getCaptionStyleMeta(style);
  const motionProps = getMotionProps(meta.motionKind, prefersReducedMotion);
  const words = splitHighlightedWords(line.text, line.highlightWords);
  const sizeClass = compact ? 'text-xs leading-snug' : 'text-sm sm:text-base leading-snug';
  const motionKey = `${style}-${line.id}-${motionTrigger}`;

  if (style === 'Neon Glow') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{
          fontFamily,
          boxShadow: `0 0 18px ${highlightColor}55`,
          textShadow: `0 0 10px ${highlightColor}, 0 2px 6px rgba(0,0,0,0.95)`,
        }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span style={{ color: w.highlighted ? highlightColor : '#FFFFFF' }}>{w.token}</span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  if (style === 'Professional') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{ fontFamily }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span
              className={w.highlighted ? 'font-bold' : ''}
              style={{ color: w.highlighted ? highlightColor : '#F8FAFC' }}
            >
              {w.token}
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  if (style === 'Comic Pop') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{
          fontFamily,
          textShadow: '2px 2px 0 #000000, -1px -1px 0 #000000, 1px -1px 0 #000000, -1px 1px 0 #000000',
        }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span
              className={w.highlighted ? 'inline-block scale-105' : ''}
              style={{ color: w.highlighted ? highlightColor : '#FFFFFF' }}
            >
              {w.token}
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  if (style === 'Gradient Box') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{ fontFamily }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span style={{ color: w.highlighted ? highlightColor : '#F8FAFC' }}>{w.token}</span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  if (style === 'Typewriter') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span style={{ color: w.highlighted ? highlightColor : '#E2E8F0' }}>{w.token}</span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
        <span
          className="inline-block w-0.5 h-3.5 ml-1 align-middle"
          style={{ backgroundColor: highlightColor }}
        />
      </motion.div>
    );
  }

  if (style === 'Glitch Kinetic') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{
          fontFamily,
          textShadow: '-2px 0 rgba(34,211,238,0.85), 2px 0 rgba(236,72,153,0.85), 0 2px 6px rgba(0,0,0,0.9)',
        }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span style={{ color: w.highlighted ? highlightColor : '#FFFFFF' }}>{w.token}</span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  if (style === 'Modern' || style === 'Bold' || style === 'Animated') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{
          fontFamily,
          textShadow: style === 'Bold' ? '0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)' : undefined,
        }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span style={{ color: w.highlighted ? highlightColor : '#FFFFFF' }}>{w.token}</span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  if (style === 'Karaoke') {
    return (
      <motion.div
        key={motionKey}
        {...motionProps}
        data-caption-theme={style}
        data-motion-kind={meta.motionKind}
        className={`inline-block max-w-[92%] text-center ${meta.cssBoxClass} ${sizeClass}`}
        style={{ fontFamily }}
      >
        {words.map((w, i) => (
          <React.Fragment key={w.key}>
            <span style={{ color: i <= Math.floor(words.length / 2) ? highlightColor : '#FFFFFF' }}>
              {w.token}
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </React.Fragment>
        ))}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={motionKey}
      {...motionProps}
      data-caption-theme={style}
      data-motion-kind={meta.motionKind}
      className={`inline-block max-w-[92%] text-center text-white ${meta.cssBoxClass} ${sizeClass}`}
      style={{ fontFamily, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
    >
      {words.map((w, i) => (
        <React.Fragment key={w.key}>
          <span>{w.token}</span>
          {i < words.length - 1 ? ' ' : ''}
        </React.Fragment>
      ))}
    </motion.div>
  );
}
