import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { App, CalendarEvent } from '../types';
import { CloseIcon } from './Icons';

interface CalendarPageProps {
  apps: App[];
  events: Record<string, CalendarEvent[]>; // appId -> events
  googleCalendarEvents?: CalendarEvent[]; // Global Google Calendar events
}

// Get default color for a project based on index
function getDefaultColor(index: number): string {
  const colors = ['#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#06b6d4', '#ef4444', '#eab308'];
  return colors[index % colors.length];
}

export function CalendarPage({ apps, events, googleCalendarEvents = [] }: CalendarPageProps) {
  const { tokens } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Get all events with project info
  const getAllEvents = () => {
    const allEvents: Array<CalendarEvent & { appId: string; appName: string; color: string }> = [];

    // Add app-specific events
    apps.forEach((app, index) => {
      const appEvents = events[app.id] || [];
      const color = app.color || getDefaultColor(index);

      appEvents.forEach(event => {
        allEvents.push({
          ...event,
          appId: app.id,
          appName: app.name,
          color,
        });
      });
    });

    // Add global Google Calendar events (use event.color which is set to project color when fetching)
    googleCalendarEvents.forEach(event => {
      allEvents.push({
        ...event,
        appId: 'google',
        appName: 'Google Calendar',
        color: event.color || '#4285f4', // Use project color if set, fallback to Google blue
      });
    });

    return allEvents;
  };

  const allEvents = getAllEvents();

  // Get events for a specific date
  const getEventsForDate = (date: Date) => {
    return allEvents.filter(event => {
      const eventDate = new Date(event.startTime);
      return isSameDay(eventDate, date);
    });
  };

  // Check if project has calendar connected (via googleCalendar config, not integrations)
  const hasCalendarConnected = (app: App) => {
    return app.googleCalendar?.enabled && app.googleCalendar?.accessToken;
  };

  // Render calendar header
  const renderHeader = () => {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '4px' }}>Calendar</h1>
          <p style={{ color: tokens.colors.textMuted, fontSize: '14px' }}>
            View events across all your projects.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: tokens.radius.sm,
              border: `1px solid ${tokens.colors.border}`,
              background: 'transparent',
              color: tokens.colors.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
            }}
          >
            ‹
          </button>
          <span style={{ fontSize: '16px', fontWeight: 600, minWidth: '160px', textAlign: 'center' }}>
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: tokens.radius.sm,
              border: `1px solid ${tokens.colors.border}`,
              background: 'transparent',
              color: tokens.colors.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
            }}
          >
            ›
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            style={{
              padding: '8px 16px',
              borderRadius: tokens.radius.sm,
              border: `1px solid ${tokens.colors.border}`,
              background: 'transparent',
              color: tokens.colors.textMuted,
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: 'inherit',
            }}
          >
            Today
          </button>
        </div>
      </div>
    );
  };

  // Render days of week header
  const renderDaysOfWeek = () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', marginBottom: '1px' }}>
        {days.map(day => (
          <div
            key={day}
            style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 600,
              color: tokens.colors.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {day}
          </div>
        ))}
      </div>
    );
  };

  // Render calendar cells
  const renderCells = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const cells: React.ReactNode[] = [];
    let day = startDate;

    while (day <= endDate) {
      const currentDay = day;
      const dayEvents = getEventsForDate(currentDay);
      const isCurrentMonth = isSameMonth(day, monthStart);
      const isToday = isSameDay(day, new Date());

      cells.push(
        <div
          key={day.toISOString()}
          onClick={() => setSelectedDate(currentDay)}
          style={{
            height: '100%',
            padding: '8px',
            background: isToday ? tokens.colors.accentGlow : tokens.colors.bgCard,
            border: `1px solid ${isToday ? tokens.colors.accent : tokens.colors.border}`,
            borderRadius: tokens.radius.md,
            cursor: 'pointer',
            opacity: isCurrentMonth ? 1 : 0.4,
            transition: 'all 0.15s ease',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          onMouseEnter={(e) => {
            if (!isToday) {
              e.currentTarget.style.background = tokens.colors.bgCardHover;
              e.currentTarget.style.borderColor = tokens.colors.borderHover;
            }
          }}
          onMouseLeave={(e) => {
            if (!isToday) {
              e.currentTarget.style.background = tokens.colors.bgCard;
              e.currentTarget.style.borderColor = tokens.colors.border;
            }
          }}
        >
          <div
            style={{
              fontSize: '14px',
              fontWeight: isToday ? 600 : 400,
              color: isToday ? tokens.colors.accent : tokens.colors.text,
              marginBottom: '6px',
            }}
          >
            {format(day, 'd')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, overflow: 'hidden' }}>
            {dayEvents.slice(0, 3).map((event, idx) => (
              <div
                key={idx}
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: `${event.color}20`,
                  borderLeft: `3px solid ${event.color}`,
                  fontSize: '11px',
                  color: tokens.colors.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {event.title}
              </div>
            ))}
            {dayEvents.length > 3 && (
              <div style={{ fontSize: '10px', color: tokens.colors.textMuted, paddingLeft: '6px' }}>
                +{dayEvents.length - 3} more
              </div>
            )}
          </div>
        </div>
      );
      day = addDays(day, 1);
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridAutoRows: '130px',
          gap: '8px',
        }}
      >
        {cells}
      </div>
    );
  };

  // Render legend
  const renderLegend = () => {
    const hasGoogleCalendar = googleCalendarEvents.length > 0;

    return (
      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '20px',
          marginTop: '24px',
        }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: tokens.colors.text }}>
          Calendar Sources
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {/* Google Calendar */}
          {hasGoogleCalendar && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '3px',
                  background: '#4285f4',
                }}
              />
              <span style={{ fontSize: '13px', color: tokens.colors.text }}>
                Google Calendar
              </span>
            </div>
          )}
          {/* App-specific calendars */}
          {apps.map((app, index) => {
            const color = app.color || getDefaultColor(index);
            const hasCalendar = hasCalendarConnected(app);

            return (
              <div
                key={app.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: hasCalendar ? 1 : 0.4,
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '3px',
                    background: hasCalendar ? color : tokens.colors.textDim,
                  }}
                />
                <span style={{ fontSize: '13px', color: hasCalendar ? tokens.colors.text : tokens.colors.textDim }}>
                  {app.name}
                </span>
                {!hasCalendar && (
                  <span style={{ fontSize: '11px', color: tokens.colors.textDim }}>
                    (not connected)
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render day view modal
  const renderDayModal = () => {
    if (!selectedDate) return null;

    const dayEvents = getEventsForDate(selectedDate);

    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setSelectedDate(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: tokens.colors.bgElevated,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.xl,
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                  {format(selectedDate, 'EEEE, MMMM d')}
                </h2>
                <p style={{ color: tokens.colors.textMuted, fontSize: '13px' }}>
                  {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: tokens.radius.sm,
                  border: `1px solid ${tokens.colors.border}`,
                  background: 'transparent',
                  color: tokens.colors.textMuted,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {dayEvents.length === 0 ? (
              <div
                style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: tokens.colors.textMuted,
                }}
              >
                No events scheduled
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {dayEvents.map((event, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '16px',
                      background: tokens.colors.bgCard,
                      border: `1px solid ${tokens.colors.border}`,
                      borderRadius: tokens.radius.md,
                      borderLeft: `4px solid ${event.color}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text }}>
                        {event.title}
                      </h4>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: `${event.color}20`,
                          color: event.color,
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {event.appName}
                      </span>
                    </div>
                    {event.description && (
                      <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
                        {event.description}
                      </p>
                    )}
                    <div style={{ fontSize: '12px', color: tokens.colors.textDim }}>
                      {format(new Date(event.startTime), 'h:mm a')}
                      {event.endTime && ` - ${format(new Date(event.endTime), 'h:mm a')}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <div>
      {renderHeader()}

      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '24px',
        }}
      >
        {renderDaysOfWeek()}
        {renderCells()}
      </div>

      {renderLegend()}
      {renderDayModal()}
    </div>
  );
}
