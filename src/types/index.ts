// Shared types for salon-booking app
// These mirror the main system types relevant to public booking.

export interface Salon {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  logo_url?: string;
  slogan?: string;
  subdomain: string;
  custom_domain?: string;
  theme_primary_color: string;
  theme_secondary_color: string;
  is_active: boolean;
}

export interface Service {
  id: string;
  salon_id: string;
  name: string;
  price: number;
  duration_minutes: number;
  description?: string;
  is_active: boolean;
  category_id?: string;
  category_name?: string;
}

export interface Addon {
  id: string;
  salon_id: string;
  name: string;
  price: number;
  duration_modifier_minutes: number; // added to service duration
  is_active: boolean;
}

export interface Worker {
  id: string;
  salon_id: string;
  name: string;
  phone?: string;
  is_active: boolean;
}

export interface AvailableSlot {
  startTime: string;  // 'HH:MM'
  endTime: string;    // 'HH:MM'
  availableStaff: { id: string; name: string }[];
}

export interface BookingSettings {
  is_enabled: boolean;
  buffer_minutes: number;
  advance_booking_days: number;
  min_advance_minutes: number;  // 2880 = 48 hours for self-booking
  cancellation_hours: number;
  working_hours_start: string;
  working_hours_end: string;
}

export interface Booking {
  id: string;
  salon_id: string;
  booking_number: string;
  public_token: string;
  guest_name: string;
  guest_phone: string;
  staff_id: string;
  staff_name?: string;
  service_id: string;
  service_name?: string;
  service_price?: number;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
  cancellation_reason?: string;
  created_at: string;
  cancelled_at?: string;
  rescheduled_at?: string;
}
