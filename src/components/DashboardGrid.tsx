import { useState, useCallback, useMemo, useEffect, ReactNode, ComponentType } from 'react';
import RGL, { WidthProvider } from 'react-grid-layout/legacy';
import { useTheme } from '../contexts/ThemeContext';
import { GridLayoutItem } from '../types';
import 'react-grid-layout/css/styles.css';

// Use WidthProvider to automatically handle container width measurement
const GridLayout = WidthProvider(RGL) as ComponentType<any>;

// Layout item type for react-grid-layout
interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

// Widget configuration with size constraints
interface WidgetConfig {
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
  maxW?: number;
  maxH?: number;
}

const WIDGET_CONFIGS: Record<string, WidgetConfig> = {
  // Stat cards - small, fixed height (~100px)
  'stat-mrr': { minW: 1, minH: 2, defaultW: 1, defaultH: 2, maxH: 4 },
  'stat-users': { minW: 1, minH: 2, defaultW: 1, defaultH: 2, maxH: 4 },
  'stat-subscribers': { minW: 1, minH: 2, defaultW: 1, defaultH: 2, maxH: 4 },
  'stat-churn': { minW: 1, minH: 2, defaultW: 1, defaultH: 2, maxH: 4 },
  // Charts - medium (~200px)
  'chart-revenue': { minW: 1, minH: 3, defaultW: 2, defaultH: 4 },
  'chart-subscribers': { minW: 1, minH: 3, defaultW: 1, defaultH: 4 },
  'chart-activity': { minW: 1, minH: 3, defaultW: 1, defaultH: 4 },
  // Calendar & Activity - larger (~260px)
  'calendar': { minW: 1, minH: 4, defaultW: 2, defaultH: 5 },
  'activity-feed': { minW: 1, minH: 4, defaultW: 2, defaultH: 5 },
  // Gmail & GitHub
  'gmail-inbox': { minW: 1, minH: 3, defaultW: 2, defaultH: 5 },
  'github-activity': { minW: 1, minH: 3, defaultW: 2, defaultH: 5 },
  // Add widget placeholder
  'add-widget': { minW: 1, minH: 2, defaultW: 1, defaultH: 3 },
};

// Default layout for new dashboards - matches original layout proportions
// rowHeight=50, so: h=2 → 100px (stats), h=4 → 200px (charts), h=5 → 250px (calendar/activity)
export const DEFAULT_LAYOUT: GridLayoutItem[] = [
  // Row 1: Stats (y=0, h=2 → ~100px to match original StatCard height)
  { i: 'stat-mrr', x: 0, y: 0, w: 1, h: 2 },
  { i: 'stat-users', x: 1, y: 0, w: 1, h: 2 },
  { i: 'stat-subscribers', x: 2, y: 0, w: 1, h: 2 },
  { i: 'stat-churn', x: 3, y: 0, w: 1, h: 2 },
  // Row 2: Charts (y=2, h=4 → 200px to match original chart heights)
  { i: 'chart-revenue', x: 0, y: 2, w: 2, h: 4 },
  { i: 'chart-subscribers', x: 2, y: 2, w: 1, h: 4 },
  { i: 'chart-activity', x: 3, y: 2, w: 1, h: 4 },
  // Row 3: Bottom widgets (y=6, h=5 → 250px, close to original 260px)
  { i: 'calendar', x: 0, y: 6, w: 2, h: 5 },
  { i: 'activity-feed', x: 2, y: 6, w: 2, h: 5 },
  // Add Widget card (y=11, after bottom widgets)
  { i: 'add-widget', x: 0, y: 11, w: 1, h: 3 },
];

interface DashboardGridProps {
  layout?: GridLayoutItem[];
  onLayoutChange?: (layout: GridLayoutItem[]) => void;
  widgetMap: Record<string, ReactNode>;
  isEditMode?: boolean; // When false, drag/resize is disabled
}

export function DashboardGrid({
  layout: initialLayout,
  onLayoutChange,
  widgetMap,
  isEditMode = true,
}: DashboardGridProps) {
  const { tokens } = useTheme();
  const [isDragging, setIsDragging] = useState(false);

  // Ensure add-widget is always present in layout
  const ensureAddWidget = useCallback((items: GridLayoutItem[]): GridLayoutItem[] => {
    const hasAddWidget = items.some(item => item.i === 'add-widget');
    if (hasAddWidget || !widgetMap['add-widget']) return items;

    // Find the lowest y position to place add-widget
    let maxY = 0;
    items.forEach(item => {
      const bottom = item.y + item.h;
      if (bottom > maxY) maxY = bottom;
    });

    return [...items, { i: 'add-widget', x: 0, y: maxY, w: 1, h: 3 }];
  }, [widgetMap]);

  // Use provided layout or default, filtered to widgets that exist
  const [layout, setLayout] = useState<GridLayoutItem[]>(() => {
    const baseLayout = initialLayout && initialLayout.length > 0 ? initialLayout : DEFAULT_LAYOUT;
    const filtered = baseLayout.filter(item => widgetMap[item.i]);
    return ensureAddWidget(filtered);
  });

  // Update layout when initialLayout changes
  useEffect(() => {
    if (initialLayout && initialLayout.length > 0) {
      const filtered = initialLayout.filter(item => widgetMap[item.i]);
      setLayout(ensureAddWidget(filtered));
    }
  }, [initialLayout, widgetMap, ensureAddWidget]);

  // Convert our layout format to react-grid-layout format
  const gridLayout = useMemo((): RGLLayout[] => {
    return layout.map(item => {
      const config = WIDGET_CONFIGS[item.i] || WIDGET_CONFIGS['add-widget'];
      return {
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: config.minW,
        minH: config.minH,
        maxW: config.maxW,
        maxH: config.maxH,
      };
    });
  }, [layout]);

  const handleLayoutChange = useCallback((newLayout: RGLLayout[]) => {
    const updatedLayout: GridLayoutItem[] = newLayout.map(item => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));
    setLayout(updatedLayout);
    onLayoutChange?.(updatedLayout);
  }, [onLayoutChange]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDragStop = useCallback(() => {
    setIsDragging(false);
  }, []);

  const cols = 4;
  const rowHeight = 50; // Tuned to match original heights: h=2→100px, h=4→200px, h=5→250px
  const margin: [number, number] = [16, 24]; // 16px horizontal, 24px vertical (matches original marginBottom)

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <GridLayout
        className="dashboard-grid"
        layout={gridLayout}
        cols={cols}
        rowHeight={rowHeight}
        margin={margin}
          containerPadding={[0, 0]}
          onLayoutChange={handleLayoutChange as any}
          onDragStart={handleDragStart}
          onDragStop={handleDragStop}
          onResizeStart={handleDragStart}
          onResizeStop={handleDragStop}
          draggableHandle=".widget-drag-handle"
          resizeHandles={isEditMode ? ['se', 'e', 's'] : []}
          isResizable={isEditMode}
          isDraggable={isEditMode}
          compactType="vertical"
          preventCollision={false}
        >
          {layout.map(item => {
            const widget = widgetMap[item.i];
            if (!widget) return null;

            return (
              <div
                key={item.i}
                style={{
                  background: tokens.colors.bgCard,
                  borderRadius: tokens.radius.lg,
                  border: `1px solid ${isEditMode ? tokens.colors.accent + '60' : tokens.colors.border}`,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  boxShadow: isEditMode ? `0 0 0 1px ${tokens.colors.accent}30` : 'none',
                }}
              >
                {/* Drag Handle - only shows in edit mode */}
                {isEditMode && (
                  <div
                    className="widget-drag-handle"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: '28px',
                      cursor: 'grab',
                      zIndex: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      background: `linear-gradient(to bottom, ${tokens.colors.bgCard}, transparent)`,
                      transition: 'opacity 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      if (!isDragging) e.currentTarget.style.opacity = '0';
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '4px',
                        borderRadius: '2px',
                        background: tokens.colors.textDim,
                      }}
                    />
                  </div>
                )}

                {/* Widget Content - disable interactions in edit mode */}
                <div style={{
                  flex: 1,
                  overflow: 'auto',
                  height: '100%',
                  pointerEvents: isEditMode ? 'none' : 'auto',
                }}>
                  {widget}
                </div>
              </div>
            );
          })}
        </GridLayout>

      {/* Custom styles */}
      <style>{`
        .dashboard-grid {
          position: relative;
        }
        .react-grid-item {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .react-grid-item.react-draggable-dragging {
          z-index: 100;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
          cursor: grabbing !important;
        }
        .react-grid-item.resizing {
          z-index: 100;
        }
        .react-grid-item > .react-resizable-handle {
          position: absolute;
          opacity: 0;
          transition: opacity 0.15s ease;
          z-index: 20;
        }
        .react-grid-item:hover > .react-resizable-handle {
          opacity: 1;
        }
        .react-resizable-handle::after {
          content: '';
          position: absolute;
          border-radius: 2px;
          background: ${tokens.colors.accent};
        }
        /* Southeast corner handle (diagonal) */
        .react-resizable-handle-se {
          width: 20px;
          height: 20px;
          bottom: 0;
          right: 0;
          cursor: se-resize;
        }
        .react-resizable-handle-se::after {
          width: 10px;
          height: 10px;
          right: 4px;
          bottom: 4px;
        }
        /* East handle (horizontal) */
        .react-resizable-handle-e {
          width: 12px;
          height: 40px;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          cursor: e-resize;
        }
        .react-resizable-handle-e::after {
          width: 4px;
          height: 24px;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
        }
        /* South handle (vertical) */
        .react-resizable-handle-s {
          width: 40px;
          height: 12px;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          cursor: s-resize;
        }
        .react-resizable-handle-s::after {
          width: 24px;
          height: 4px;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
        }
        .react-grid-placeholder {
          background: ${tokens.colors.accent}20 !important;
          border: 2px dashed ${tokens.colors.accent} !important;
          border-radius: ${tokens.radius.lg} !important;
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}

// Helper to add a widget to the layout
export function addWidgetToLayout(
  layout: GridLayoutItem[],
  widgetId: string,
): GridLayoutItem[] {
  const config = WIDGET_CONFIGS[widgetId] || WIDGET_CONFIGS['add-widget'];

  // Find the lowest y position
  let maxY = 0;
  layout.forEach(item => {
    const bottom = item.y + item.h;
    if (bottom > maxY) maxY = bottom;
  });

  return [
    ...layout,
    {
      i: widgetId,
      x: 0,
      y: maxY,
      w: config.defaultW,
      h: config.defaultH,
    },
  ];
}

// Helper to remove a widget from the layout
export function removeWidgetFromLayout(
  layout: GridLayoutItem[],
  widgetId: string,
): GridLayoutItem[] {
  return layout.filter(item => item.i !== widgetId);
}

export { WIDGET_CONFIGS };
