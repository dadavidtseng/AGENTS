/**
 * Navigation — Portfolio-style fixed top nav with scroll-aware frosted glass.
 *
 * Features:
 *  - Transparent at top, frosted glass on scroll
 *  - Responsive: desktop links + mobile hamburger menu
 *  - Notification bell with unread badge + slide-out drawer
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationBell } from './NotificationBell';
import { NotificationCenter } from './NotificationCenter';
import { ToastContainer } from './ToastContainer';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard' },
  { 
    path: '/board', 
    label: 'Board',
    submenu: [
      { path: '/board/quests', label: 'Quests' },
      { path: '/board/tasks', label: 'Tasks' },
    ]
  },
  { path: '/backlog', label: 'Backlog' },
  { path: '/network', label: 'Network' },
  { path: '/tools',   label: 'Tools' },
  { path: '/events',  label: 'Events' },
  { path: '/agents',  label: 'Agents' },
  { path: '/logs',    label: 'Logs' },
];

export function Navigation() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    notifications,
    toasts,
    unreadCount,
    markRead,
    markAllRead,
    dismissToast,
    clearAll,
  } = useNotifications();

  // Track scroll position for frosted glass effect
  const handleScroll = useCallback(() => {
    setScrolled(window.scrollY > 8);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const navClasses = scrolled || mobileOpen
    ? 'bg-bg/80 backdrop-blur-xl backdrop-saturate-[180%] border-border'
    : 'border-transparent';

  return (
    <>
      <nav
        className={`fixed top-0 left-0 w-full z-50 px-8 h-16 flex items-center justify-between transition-all duration-300 border-b ${navClasses}`}
      >
        {/* Brand */}
        <Link
          to="/"
          className="text-[0.95rem] font-semibold tracking-tight text-text-primary"
        >
          Quest Dashboard
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            
            // Handle submenu items
            if ('submenu' in item && item.submenu) {
              return (
                <div key={item.path} className="relative group">
                  <Link
                    to={item.path}
                    className={`text-sm no-underline px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
                      isActive
                        ? 'text-text-primary bg-bg-card border border-border-hover'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                    }`}
                  >
                    {item.label}
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </Link>
                  
                  {/* Dropdown submenu */}
                  <div className="absolute top-full left-0 mt-1 py-1 bg-bg-card border border-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 min-w-[140px]">
                    {item.submenu.map((subitem) => (
                      <Link
                        key={subitem.path}
                        to={subitem.path}
                        className={`block px-3 py-2 text-sm transition-colors ${
                          location.pathname === subitem.path
                            ? 'text-text-primary bg-bg-elevated'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                        }`}
                      >
                        {subitem.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }
            
            // Regular nav item
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`text-sm no-underline px-3 py-1.5 rounded-md transition-colors ${
                  isActive
                    ? 'text-text-primary bg-bg-card border border-border-hover'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {/* Notification bell (desktop) */}
          <NotificationBell
            unreadCount={unreadCount}
            onClick={() => setDrawerOpen((v) => !v)}
          />
        </div>

        {/* Mobile: bell + hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <NotificationBell
            unreadCount={unreadCount}
            onClick={() => setDrawerOpen((v) => !v)}
          />
          <button
            className="flex flex-col justify-center items-center w-8 h-8 gap-[5px]"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            <span
              className={`block w-5 h-px bg-text-primary transition-all duration-300 ${
                mobileOpen ? 'translate-y-[3px] rotate-45' : ''
              }`}
            />
            <span
              className={`block w-5 h-px bg-text-primary transition-all duration-300 ${
                mobileOpen ? '-translate-y-[3px] -rotate-45' : ''
              }`}
            />
          </button>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 top-16 z-40 md:hidden bg-bg/95 backdrop-blur-md overflow-y-auto mobile-menu-enter">
          <div className="flex flex-col px-8 py-6 gap-1">
            {NAV_ITEMS.map((item, i) => {
              const isActive = location.pathname.startsWith(item.path);
              
              // Handle submenu items in mobile
              if ('submenu' in item && item.submenu) {
                return (
                  <div key={item.path}>
                    <Link
                      to={item.path}
                      className={`text-[1.1rem] no-underline py-3 border-b border-border transition-colors mobile-menu-item block`}
                      style={{ animationDelay: `${i * 0.05}s` }}
                    >
                      <span className={isActive ? 'text-text-primary' : 'text-text-secondary'}>
                        {item.label}
                      </span>
                    </Link>
                    {/* Submenu items */}
                    <div className="pl-4 mt-1">
                      {item.submenu.map((subitem, j) => (
                        <Link
                          key={subitem.path}
                          to={subitem.path}
                          className={`text-[0.95rem] no-underline py-2 block transition-colors mobile-menu-item`}
                          style={{ animationDelay: `${(i + j * 0.3) * 0.05}s` }}
                        >
                          <span className={location.pathname === subitem.path ? 'text-text-primary' : 'text-text-tertiary'}>
                            → {subitem.label}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }
              
              // Regular nav item
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`text-[1.1rem] no-underline py-3 border-b border-border transition-colors mobile-menu-item`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <span className={isActive ? 'text-text-primary' : 'text-text-secondary'}>
                    {item.label}
                  </span>
                </Link>
              );
            })}

          </div>
        </div>
      )}

      {/* Notification drawer */}
      <NotificationCenter
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        notifications={notifications}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
        onClearAll={clearAll}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
