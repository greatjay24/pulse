import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { CalendarEvent } from '../types';
import { CloseIcon } from './Icons';

interface MiniCalendarProps {
  events?: CalendarEvent[];
  onViewAll?: () => void;
}

const eventTypeColors: Record<string, string> = {
  meeting: '#818cf8',
  deadline: '#f87171',
  renewal: '#34d399',
  trial_end: '#fbbf24',
  payout: '#22d3ee',
  other: '#9ca3af',
};

// Get color for calendar events - prioritize project color for unified appearance
const getEventColor = (event: CalendarEvent) => {
  // Use the project/app color first (unified color per project)
  if (event.color) return event.color;
  // Fallback to calendar's color if available (from Google Calendar)
  if (event.calendarColor) return event.calendarColor;
  // Default Google blue for Google events
  if (event.source === 'google') return '#4285f4';
  // Use type-based colors for other events
  return eventTypeColors[event.type] || eventTypeColors.other;
};

export function MiniCalendar({ events = [], onViewAll }: MiniCalendarProps) {
  const { tokens } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<{ day: number; events: CalendarEvent[] } | null>(null);
  const [showFullCalendar, setShowFullCalendar] = useState(false);

  const currentMonthName = currentMonth.toLocaleString('default', { month: 'long' });
  const currentYear = currentMonth.getFullYear();
  const today = new Date();
  const isCurrentMonth = currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();
  const currentDay = today.getDate();

  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  // Group events by day for the current viewing month
  const eventsByDay = events.reduce((acc, event) => {
    const eventDate = new Date(event.startTime);
    if (eventDate.getMonth() === currentMonth.getMonth() && eventDate.getFullYear() === currentMonth.getFullYear()) {
      const day = eventDate.getDate();
      if (!acc[day]) acc[day] = [];
      acc[day].push(event);
    }
    return acc;
  }, {} as Record<number, CalendarEvent[]>);

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const handleDayClick = (e: React.MouseEvent, day: number, dayEvents: CalendarEvent[]) => {
    e.stopPropagation();
    if (dayEvents.length > 0) {
      setSelectedDay({ day, events: dayEvents });
    }
  };

  const handleCalendarClick = () => {
    setShowFullCalendar(true);
  };

  const formatEventTime = (event: CalendarEvent) => {
    const date = new Date(event.startTime);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Get all events grouped by day for the full calendar view
  const getEventsForMonth = () => {
    const monthEvents: { day: number; events: CalendarEvent[] }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = eventsByDay[day] || [];
      if (dayEvents.length > 0) {
        monthEvents.push({ day, events: dayEvents });
      }
    }
    return monthEvents;
  };

  return (
    <>
      <div
        onClick={handleCalendarClick}
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '20px',
          backdropFilter: 'blur(20px)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = tokens.colors.bgCardHover;
          e.currentTarget.style.borderColor = tokens.colors.borderHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = tokens.colors.bgCard;
          e.currentTarget.style.borderColor = tokens.colors.border;
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>
            {currentMonthName} {currentYear}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={handlePrevMonth}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: tokens.colors.textMuted,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = tokens.colors.bgCardHover}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              ‹
            </button>
            <button
              onClick={handleNextMonth}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: tokens.colors.textMuted,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = tokens.colors.bgCardHover}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              ›
            </button>
          </div>
        </div>

        {/* Days of Week */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '4px',
            textAlign: 'center',
            marginBottom: '8px',
          }}
        >
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <div
              key={i}
              style={{
                fontSize: '11px',
                color: tokens.colors.textDim,
                padding: '4px',
                fontWeight: 500,
              }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '4px',
            textAlign: 'center',
            flex: 1,
          }}
        >
          {days.map((day, i) => {
            const dayEvents = day ? eventsByDay[day] || [] : [];
            const hasEvents = dayEvents.length > 0;
            const isToday = isCurrentMonth && day === currentDay;
            const maxDots = 4; // Max dots to show
            const dotCount = Math.min(dayEvents.length, maxDots);

            return (
              <div
                key={i}
                onClick={(e) => day && handleDayClick(e, day, dayEvents)}
                style={{
                  padding: '6px 4px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  cursor: day && hasEvents ? 'pointer' : 'default',
                  position: 'relative',
                  background: isToday ? tokens.colors.accent : 'transparent',
                  color: isToday ? 'white' : day ? tokens.colors.text : 'transparent',
                  fontWeight: isToday ? 600 : 400,
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (day && hasEvents && !isToday) {
                    e.currentTarget.style.background = tokens.colors.bgCardHover;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isToday) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {day}
                {day && hasEvents && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '2px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      gap: '2px',
                    }}
                  >
                    {Array.from({ length: dotCount }).map((_, idx) => (
                      <div
                        key={idx}
                        style={{
                          width: '3px',
                          height: '3px',
                          borderRadius: '50%',
                          background: isToday ? 'white' : getEventColor(dayEvents[idx]),
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty state hint */}
        {events.length === 0 && (
          <div
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: `1px solid ${tokens.colors.border}`,
            }}
          >
            <p
              style={{
                fontSize: '12px',
                color: tokens.colors.textDim,
                textAlign: 'center',
              }}
            >
              Connect Google Calendar to see your events
            </p>
          </div>
        )}

        {onViewAll && events.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewAll();
            }}
            style={{
              marginTop: '12px',
              fontSize: '12px',
              color: tokens.colors.accent,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            View all events
          </button>
        )}
      </div>

      {/* Day Detail Modal */}
      {selectedDay && (
        <div
          onClick={() => setSelectedDay(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: tokens.colors.bgElevated,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.xl,
              padding: '24px',
              width: '90%',
              maxWidth: '400px',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: tokens.colors.text }}>
                  {currentMonthName} {selectedDay.day}, {currentYear}
                </h2>
                <p style={{ color: tokens.colors.textMuted, fontSize: '13px' }}>
                  {selectedDay.events.length} event{selectedDay.events.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {selectedDay.events.map((event, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '16px',
                    background: tokens.colors.bgCard,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.md,
                    borderLeft: `4px solid ${getEventColor(event)}`,
                  }}
                >
                  <h4 style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text, marginBottom: '4px' }}>
                    {event.title}
                  </h4>
                  {event.calendarName && (
                    <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: getEventColor(event) }} />
                      {event.calendarName}
                    </div>
                  )}
                  {event.description && (
                    <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
                      {event.description.length > 100 ? event.description.slice(0, 100) + '...' : event.description}
                    </p>
                  )}
                  <div style={{ fontSize: '12px', color: tokens.colors.textDim }}>
                    {formatEventTime(event)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full Calendar Modal */}
      {showFullCalendar && (
        <div
          onClick={() => setShowFullCalendar(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: tokens.colors.bgElevated,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.xl,
              padding: '24px',
              width: '90%',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button
                  onClick={handlePrevMonth}
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
                  ‹
                </button>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text, minWidth: '160px', textAlign: 'center' }}>
                  {currentMonthName} {currentYear}
                </h2>
                <button
                  onClick={handleNextMonth}
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
                  ›
                </button>
              </div>
              <button
                onClick={() => setShowFullCalendar(false)}
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

            {/* Events List */}
            {getEventsForMonth().length === 0 ? (
              <div
                style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: tokens.colors.textMuted,
                }}
              >
                No events this month
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {getEventsForMonth().map(({ day, events: dayEvents }) => (
                  <div key={day}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: tokens.colors.textMuted,
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: isCurrentMonth && day === currentDay ? tokens.colors.accent : tokens.colors.bgCard,
                          color: isCurrentMonth && day === currentDay ? 'white' : tokens.colors.text,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        {day}
                      </span>
                      {new Date(currentYear, currentMonth.getMonth(), day).toLocaleDateString('en-US', { weekday: 'long' })}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '36px' }}>
                      {dayEvents.map((event, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '12px 16px',
                            background: tokens.colors.bgCard,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.md,
                            borderLeft: `4px solid ${getEventColor(event)}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <h4 style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text, marginBottom: '2px' }}>
                                {event.title}
                              </h4>
                              {event.calendarName && (
                                <div style={{ fontSize: '10px', color: tokens.colors.textDim, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: getEventColor(event) }} />
                                  {event.calendarName}
                                </div>
                              )}
                              {event.description && (
                                <p style={{ fontSize: '12px', color: tokens.colors.textMuted }}>
                                  {event.description.length > 60 ? event.description.slice(0, 60) + '...' : event.description}
                                </p>
                              )}
                            </div>
                            <span style={{ fontSize: '11px', color: tokens.colors.textDim, whiteSpace: 'nowrap', marginLeft: '12px' }}>
                              {formatEventTime(event)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
