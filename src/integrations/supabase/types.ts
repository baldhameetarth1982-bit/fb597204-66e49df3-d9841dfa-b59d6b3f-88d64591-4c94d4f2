export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _scheduler_tokens: {
        Row: {
          created_at: string
          name: string
          token: string
        }
        Insert: {
          created_at?: string
          name: string
          token: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
        }
        Relationships: []
      }
      achievements: {
        Row: {
          awarded_at: string
          code: string
          description: string | null
          id: string
          society_id: string
          title: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          code: string
          description?: string | null
          id?: string
          society_id: string
          title: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          code?: string
          description?: string | null
          id?: string
          society_id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      ad_event_daily: {
        Row: {
          ad_id: string
          clicks: number
          cta: number
          day: string
          placement: string
          views: number
        }
        Insert: {
          ad_id: string
          clicks?: number
          cta?: number
          day: string
          placement: string
          views?: number
        }
        Update: {
          ad_id?: string
          clicks?: number
          cta?: number
          day?: string
          placement?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "ad_event_daily_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_event_dedupe: {
        Row: {
          created_at: string
          k: string
        }
        Insert: {
          created_at?: string
          k: string
        }
        Update: {
          created_at?: string
          k?: string
        }
        Relationships: []
      }
      ads: {
        Row: {
          active: boolean
          archived_at: string | null
          business_name: string | null
          category_id: string | null
          created_at: string
          cta_label: string | null
          description: string | null
          ends_at: string | null
          id: string
          image_path: string | null
          image_url: string
          kind: string
          link_url: string
          phone: string | null
          placement: string
          sort_order: number
          sponsored: boolean
          starts_at: string | null
          target_cities: string[]
          target_plans: string[]
          target_society_ids: string[]
          title: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          business_name?: string | null
          category_id?: string | null
          created_at?: string
          cta_label?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          image_path?: string | null
          image_url: string
          kind?: string
          link_url: string
          phone?: string | null
          placement?: string
          sort_order?: number
          sponsored?: boolean
          starts_at?: string | null
          target_cities?: string[]
          target_plans?: string[]
          target_society_ids?: string[]
          title: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          business_name?: string | null
          category_id?: string | null
          created_at?: string
          cta_label?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          image_path?: string | null
          image_url?: string
          kind?: string
          link_url?: string
          phone?: string | null
          placement?: string
          sort_order?: number
          sponsored?: boolean
          starts_at?: string | null
          target_cities?: string[]
          target_plans?: string[]
          target_society_ids?: string[]
          title?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      agm_agenda_items: {
        Row: {
          agm_id: string
          description: string | null
          election_id: string | null
          id: string
          kind: string
          poll_id: string | null
          seq: number
          society_id: string
          source_id: string | null
          title: string
        }
        Insert: {
          agm_id: string
          description?: string | null
          election_id?: string | null
          id?: string
          kind?: string
          poll_id?: string | null
          seq: number
          society_id: string
          source_id?: string | null
          title: string
        }
        Update: {
          agm_id?: string
          description?: string | null
          election_id?: string | null
          id?: string
          kind?: string
          poll_id?: string | null
          seq?: number
          society_id?: string
          source_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agm_agenda_items_agm_id_fkey"
            columns: ["agm_id"]
            isOneToOne: false
            referencedRelation: "agms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_agenda_items_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_agenda_items_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_agenda_items_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_agenda_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "society_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      agm_minutes_versions: {
        Row: {
          agm_id: string
          body: string
          correction_reason: string | null
          created_at: string
          created_by: string
          id: string
          published_at: string | null
          published_by: string | null
          society_id: string
          status: string
          version: number
        }
        Insert: {
          agm_id: string
          body: string
          correction_reason?: string | null
          created_at?: string
          created_by: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          society_id: string
          status?: string
          version: number
        }
        Update: {
          agm_id?: string
          body?: string
          correction_reason?: string | null
          created_at?: string
          created_by?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          society_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agm_minutes_versions_agm_id_fkey"
            columns: ["agm_id"]
            isOneToOne: false
            referencedRelation: "agms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_minutes_versions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      agm_resolutions: {
        Row: {
          agenda_item_id: string | null
          agm_id: string
          body: string
          created_at: string
          created_by: string
          decided_at: string | null
          id: string
          poll_id: string | null
          seq: number
          society_id: string
          status: string
          title: string
        }
        Insert: {
          agenda_item_id?: string | null
          agm_id: string
          body: string
          created_at?: string
          created_by: string
          decided_at?: string | null
          id?: string
          poll_id?: string | null
          seq: number
          society_id: string
          status?: string
          title: string
        }
        Update: {
          agenda_item_id?: string | null
          agm_id?: string
          body?: string
          created_at?: string
          created_by?: string
          decided_at?: string | null
          id?: string
          poll_id?: string | null
          seq?: number
          society_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agm_resolutions_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agm_agenda_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_resolutions_agm_id_fkey"
            columns: ["agm_id"]
            isOneToOne: false
            referencedRelation: "agms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_resolutions_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agm_resolutions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      agms: {
        Row: {
          archive_reason: string | null
          created_at: string
          created_by: string
          financial_year: string
          id: string
          meeting_id: string
          notice_date: string | null
          quorum_basis: string
          quorum_snapshot: Json | null
          quorum_type: string
          quorum_value: number
          society_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          created_at?: string
          created_by: string
          financial_year: string
          id?: string
          meeting_id: string
          notice_date?: string | null
          quorum_basis?: string
          quorum_snapshot?: Json | null
          quorum_type?: string
          quorum_value: number
          society_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          created_at?: string
          created_by?: string
          financial_year?: string
          id?: string
          meeting_id?: string
          notice_date?: string | null
          quorum_basis?: string
          quorum_snapshot?: Json | null
          quorum_type?: string
          quorum_value?: number
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agms_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agms_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          created_at: string
          feature: string
          id: string
          input_tokens: number | null
          latency_ms: number | null
          output_tokens: number | null
          society_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          output_tokens?: number | null
          society_id?: string | null
          status: string
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          output_tokens?: number | null
          society_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenities: {
        Row: {
          advance_days: number
          amenity_type: string
          cancellation_hours: number
          capacity: number
          closes_at: string
          created_at: string
          created_by: string
          defaulters_allowed: boolean
          deposit_amount: number
          description: string | null
          fee_amount: number
          household_allowed: boolean
          id: string
          is_active: boolean
          name: string
          opens_at: string
          owner_allowed: boolean
          slot_minutes: number
          society_id: string
          tenant_allowed: boolean
          updated_at: string
          weekly_household_limit: number | null
        }
        Insert: {
          advance_days?: number
          amenity_type?: string
          cancellation_hours?: number
          capacity?: number
          closes_at?: string
          created_at?: string
          created_by: string
          defaulters_allowed?: boolean
          deposit_amount?: number
          description?: string | null
          fee_amount?: number
          household_allowed?: boolean
          id?: string
          is_active?: boolean
          name: string
          opens_at?: string
          owner_allowed?: boolean
          slot_minutes?: number
          society_id: string
          tenant_allowed?: boolean
          updated_at?: string
          weekly_household_limit?: number | null
        }
        Update: {
          advance_days?: number
          amenity_type?: string
          cancellation_hours?: number
          capacity?: number
          closes_at?: string
          created_at?: string
          created_by?: string
          defaulters_allowed?: boolean
          deposit_amount?: number
          description?: string | null
          fee_amount?: number
          household_allowed?: boolean
          id?: string
          is_active?: boolean
          name?: string
          opens_at?: string
          owner_allowed?: boolean
          slot_minutes?: number
          society_id?: string
          tenant_allowed?: boolean
          updated_at?: string
          weekly_household_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "amenities_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_blocked_dates: {
        Row: {
          amenity_id: string
          blocked_date: string
          created_at: string
          created_by: string
          id: string
          reason: string | null
          society_id: string
        }
        Insert: {
          amenity_id: string
          blocked_date: string
          created_at?: string
          created_by: string
          id?: string
          reason?: string | null
          society_id: string
        }
        Update: {
          amenity_id?: string
          blocked_date?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_blocked_dates_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_blocked_dates_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_bookings: {
        Row: {
          amenity_id: string
          attendees: number
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          ends_at: string
          flat_id: string
          id: string
          idempotency_key: string
          society_id: string
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amenity_id: string
          attendees?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          ends_at: string
          flat_id: string
          id?: string
          idempotency_key: string
          society_id: string
          starts_at: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amenity_id?: string
          attendees?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          ends_at?: string
          flat_id?: string
          id?: string
          idempotency_key?: string
          society_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_bookings_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_bookings_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_bookings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_class_attendance: {
        Row: {
          class_id: string
          created_at: string
          enrollment_id: string
          id: string
          marked_by: string | null
          method: string
          session_date: string
          society_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          enrollment_id: string
          id?: string
          marked_by?: string | null
          method: string
          session_date: string
          society_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          marked_by?: string | null
          method?: string
          session_date?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_class_attendance_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "amenity_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_class_attendance_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "amenity_class_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_class_attendance_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_class_checkin_codes: {
        Row: {
          class_id: string
          created_at: string
          created_by: string
          expires_at: string
          session_date: string
          society_id: string
          token_hash: string
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by: string
          expires_at: string
          session_date: string
          society_id: string
          token_hash: string
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          session_date?: string
          society_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_class_checkin_codes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "amenity_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_class_checkin_codes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_class_enrollments: {
        Row: {
          cancel_reason: string | null
          class_id: string
          created_at: string
          flat_id: string
          id: string
          society_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_reason?: string | null
          class_id: string
          created_at?: string
          flat_id: string
          id?: string
          society_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_reason?: string | null
          class_id?: string
          created_at?: string
          flat_id?: string
          id?: string
          society_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_class_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "amenity_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_class_enrollments_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_class_enrollments_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_classes: {
        Row: {
          amenity_id: string
          cancel_reason: string | null
          capacity: number
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number
          ends_on: string | null
          id: string
          instructor_id: string | null
          society_id: string
          start_time: string
          starts_on: string
          status: string
          title: string
          weekdays: number[]
        }
        Insert: {
          amenity_id: string
          cancel_reason?: string | null
          capacity: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes: number
          ends_on?: string | null
          id?: string
          instructor_id?: string | null
          society_id: string
          start_time: string
          starts_on: string
          status?: string
          title: string
          weekdays: number[]
        }
        Update: {
          amenity_id?: string
          cancel_reason?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          ends_on?: string | null
          id?: string
          instructor_id?: string | null
          society_id?: string
          start_time?: string
          starts_on?: string
          status?: string
          title?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "amenity_classes_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_classes_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "amenity_instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_classes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_instructors: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          society_id: string
          specialty: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          society_id: string
          specialty?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          society_id?: string
          specialty?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "amenity_instructors_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_waitlist_events: {
        Row: {
          actor_id: string | null
          amenity_id: string
          candidate_booking_id: string | null
          created_at: string
          freed_booking_id: string | null
          id: string
          outcome: string
          reason: string | null
          society_id: string
        }
        Insert: {
          actor_id?: string | null
          amenity_id: string
          candidate_booking_id?: string | null
          created_at?: string
          freed_booking_id?: string | null
          id?: string
          outcome: string
          reason?: string | null
          society_id: string
        }
        Update: {
          actor_id?: string | null
          amenity_id?: string
          candidate_booking_id?: string | null
          created_at?: string
          freed_booking_id?: string | null
          id?: string
          outcome?: string
          reason?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_waitlist_events_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_waitlist_events_candidate_booking_id_fkey"
            columns: ["candidate_booking_id"]
            isOneToOne: false
            referencedRelation: "amenity_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_waitlist_events_freed_booking_id_fkey"
            columns: ["freed_booking_id"]
            isOneToOne: false
            referencedRelation: "amenity_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_waitlist_events_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_depreciation_settings: {
        Row: {
          asset_id: string
          cost: number
          life_years: number | null
          method: string
          salvage: number
          society_id: string
          start_date: string
          updated_at: string
          updated_by: string | null
          wdv_rate: number | null
        }
        Insert: {
          asset_id: string
          cost: number
          life_years?: number | null
          method: string
          salvage?: number
          society_id: string
          start_date: string
          updated_at?: string
          updated_by?: string | null
          wdv_rate?: number | null
        }
        Update: {
          asset_id?: string
          cost?: number
          life_years?: number | null
          method?: string
          salvage?: number
          society_id?: string
          start_date?: string
          updated_at?: string
          updated_by?: string | null
          wdv_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_depreciation_settings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "society_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_depreciation_settings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_service_log: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          expense_id: string | null
          id: string
          kind: string
          notes: string | null
          service_date: string
          society_id: string
          ticket_id: string | null
          vendor_id: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          expense_id?: string | null
          id?: string
          kind: string
          notes?: string | null
          service_date: string
          society_id: string
          ticket_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          expense_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          service_date?: string
          society_id?: string
          ticket_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_service_log_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "society_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_service_log_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_service_log_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_service_log_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_service_log_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json
          society_id: string | null
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          society_id?: string | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          society_id?: string | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      bank_statement_imports: {
        Row: {
          created_at: string
          created_by: string
          duplicate_count: number
          file_name: string
          file_sha256: string
          id: string
          row_count: number
          society_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          duplicate_count?: number
          file_name: string
          file_sha256: string
          id?: string
          row_count: number
          society_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          duplicate_count?: number
          file_name?: string
          file_sha256?: string
          id?: string
          row_count?: number
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          amount: number
          candidate_count: number
          created_at: string
          description: string
          direction: string
          fingerprint: string
          id: string
          import_id: string
          is_duplicate: boolean
          line_no: number
          match_strength: string | null
          matched_at: string | null
          matched_by: string | null
          matched_id: string | null
          matched_kind: string | null
          note: string | null
          reference: string | null
          society_id: string
          status: string
          suggested_id: string | null
          suggested_kind: string | null
          txn_date: string
          updated_at: string
        }
        Insert: {
          amount: number
          candidate_count?: number
          created_at?: string
          description: string
          direction: string
          fingerprint: string
          id?: string
          import_id: string
          is_duplicate?: boolean
          line_no: number
          match_strength?: string | null
          matched_at?: string | null
          matched_by?: string | null
          matched_id?: string | null
          matched_kind?: string | null
          note?: string | null
          reference?: string | null
          society_id: string
          status?: string
          suggested_id?: string | null
          suggested_kind?: string | null
          txn_date: string
          updated_at?: string
        }
        Update: {
          amount?: number
          candidate_count?: number
          created_at?: string
          description?: string
          direction?: string
          fingerprint?: string
          id?: string
          import_id?: string
          is_duplicate?: boolean
          line_no?: number
          match_strength?: string | null
          matched_at?: string | null
          matched_by?: string | null
          matched_id?: string | null
          matched_kind?: string | null
          note?: string | null
          reference?: string | null
          society_id?: string
          status?: string
          suggested_id?: string | null
          suggested_kind?: string | null
          txn_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      barrier_commands: {
        Row: {
          completed_at: string | null
          created_at: string
          device_id: string
          id: string
          provider_message: string | null
          reason: string
          request_id: string
          requested_by: string
          society_id: string
          status: string
          visitor_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          device_id: string
          id?: string
          provider_message?: string | null
          reason: string
          request_id: string
          requested_by: string
          society_id: string
          status: string
          visitor_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          device_id?: string
          id?: string
          provider_message?: string | null
          reason?: string
          request_id?: string
          requested_by?: string
          society_id?: string
          status?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barrier_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "gate_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barrier_commands_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_adjustments: {
        Row: {
          amount: number
          bill_id: string
          counter_of: string | null
          created_at: string
          created_by: string
          id: string
          reason: string
          request_id: string
          society_id: string
        }
        Insert: {
          amount: number
          bill_id: string
          counter_of?: string | null
          created_at?: string
          created_by: string
          id?: string
          reason: string
          request_id: string
          society_id: string
        }
        Update: {
          amount?: number
          bill_id?: string
          counter_of?: string | null
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          request_id?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_adjustments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_adjustments_counter_of_fkey"
            columns: ["counter_of"]
            isOneToOne: false
            referencedRelation: "bill_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_adjustments_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_generation_batches: {
        Row: {
          approval_id: string | null
          bills_created: number
          created_at: string
          created_by: string | null
          cycle_config_id: string
          finalized_at: string
          id: string
          request_id: string
          society_id: string
          status: string
          template_id: string
          total_amount: number
        }
        Insert: {
          approval_id?: string | null
          bills_created?: number
          created_at?: string
          created_by?: string | null
          cycle_config_id: string
          finalized_at?: string
          id?: string
          request_id: string
          society_id: string
          status?: string
          template_id: string
          total_amount?: number
        }
        Update: {
          approval_id?: string | null
          bills_created?: number
          created_at?: string
          created_by?: string | null
          cycle_config_id?: string
          finalized_at?: string
          id?: string
          request_id?: string
          society_id?: string
          status?: string
          template_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_generation_batches_cycle_config_id_fkey"
            columns: ["cycle_config_id"]
            isOneToOne: false
            referencedRelation: "billing_cycle_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_generation_batches_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_generation_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "billing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_line_items: {
        Row: {
          amount: number
          bill_id: string
          created_at: string
          description: string
          id: string
          kind: string
          maintenance_period_id: string | null
          society_id: string
        }
        Insert: {
          amount: number
          bill_id: string
          created_at?: string
          description: string
          id?: string
          kind: string
          maintenance_period_id?: string | null
          society_id: string
        }
        Update: {
          amount?: number
          bill_id?: string
          created_at?: string
          description?: string
          id?: string
          kind?: string
          maintenance_period_id?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_line_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_line_items_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_number_sequences: {
        Row: {
          id: string
          last_number: number
          period_yyyymm: string
          prefix: string
          society_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          last_number?: number
          period_yyyymm: string
          prefix?: string
          society_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          last_number?: number
          period_yyyymm?: string
          prefix?: string
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_number_sequences_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_run_approvals: {
        Row: {
          consumed_batch_id: string | null
          cycle_config_id: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          fingerprint: string
          id: string
          requested_at: string
          requested_by: string
          society_id: string
          status: string
          total_amount: number
          unit_count: number
        }
        Insert: {
          consumed_batch_id?: string | null
          cycle_config_id: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fingerprint: string
          id?: string
          requested_at?: string
          requested_by: string
          society_id: string
          status?: string
          total_amount?: number
          unit_count?: number
        }
        Update: {
          consumed_batch_id?: string | null
          cycle_config_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fingerprint?: string
          id?: string
          requested_at?: string
          requested_by?: string
          society_id?: string
          status?: string
          total_amount?: number
          unit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_run_approvals_cycle_config_id_fkey"
            columns: ["cycle_config_id"]
            isOneToOne: false
            referencedRelation: "billing_cycle_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_run_approvals_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_charge_heads: {
        Row: {
          active: boolean
          archived_at: string | null
          category: string
          created_at: string
          created_by: string | null
          default_amount: number | null
          description: string | null
          id: string
          name: string
          normalized_name: string
          society_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          default_amount?: number | null
          description?: string | null
          id?: string
          name: string
          normalized_name: string
          society_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          default_amount?: number | null
          description?: string | null
          id?: string
          name?: string
          normalized_name?: string
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_charge_heads_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_cycle_configs: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          cycle_name: string
          due_date: string
          id: string
          period_end: string
          period_start: string
          society_id: string
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          cycle_name: string
          due_date: string
          id?: string
          period_end: string
          period_start: string
          society_id: string
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          cycle_name?: string
          due_date?: string
          id?: string
          period_end?: string
          period_start?: string
          society_id?: string
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_cycle_configs_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_cycle_configs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "billing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_schedules: {
        Row: {
          amount: number
          anchor_day: number
          created_at: string
          cycle: string
          due_offset_days: number
          enabled: boolean
          id: string
          last_run_at: string | null
          last_run_count: number | null
          last_run_total: number | null
          late_fee_type: string
          late_fee_value: number
          mode: string
          next_run_at: string
          prorate: boolean
          society_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          anchor_day?: number
          created_at?: string
          cycle?: string
          due_offset_days?: number
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_run_count?: number | null
          last_run_total?: number | null
          late_fee_type?: string
          late_fee_value?: number
          mode?: string
          next_run_at?: string
          prorate?: boolean
          society_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          anchor_day?: number
          created_at?: string
          cycle?: string
          due_offset_days?: number
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_run_count?: number | null
          last_run_total?: number | null
          late_fee_type?: string
          late_fee_value?: number
          mode?: string
          next_run_at?: string
          prorate?: boolean
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_schedules_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_template_lines: {
        Row: {
          active: boolean
          amount: number | null
          archived_at: string | null
          area_unit: string | null
          charge_head_id: string
          created_at: string
          created_by: string | null
          id: string
          rate_per_area: number | null
          required_approval: boolean
          rule_type: string
          society_id: string
          sort_order: number
          template_id: string
          unit_type: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount?: number | null
          archived_at?: string | null
          area_unit?: string | null
          charge_head_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          rate_per_area?: number | null
          required_approval?: boolean
          rule_type: string
          society_id: string
          sort_order?: number
          template_id: string
          unit_type?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number | null
          archived_at?: string | null
          area_unit?: string | null
          charge_head_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          rate_per_area?: number | null
          required_approval?: boolean
          rule_type?: string
          society_id?: string
          sort_order?: number
          template_id?: string
          unit_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_template_lines_charge_head_id_fkey"
            columns: ["charge_head_id"]
            isOneToOne: false
            referencedRelation: "billing_charge_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_template_lines_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "billing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_templates: {
        Row: {
          archived_at: string | null
          billing_frequency: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          name: string
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          billing_frequency?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          name: string
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          billing_frequency?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          name?: string
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_templates_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          adjustments: number
          amount: number
          bill_date: string
          bill_number: string | null
          calc_snapshot: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          current_charges: number | null
          cycle_config_id: string | null
          due_date: string
          finalized_at: string | null
          flat_id: string
          generated_by: string | null
          generation_batch_id: string | null
          id: string
          last_decay_date: string | null
          notes: string | null
          paid_at: string | null
          penalties: number
          period_end: string
          period_label: string
          period_start: string
          previous_balance: number
          replaced_by_bill_id: string | null
          society_id: string
          status: string
          tax_amount: number
          template_id: string | null
          total_payable: number | null
          updated_at: string
        }
        Insert: {
          adjustments?: number
          amount: number
          bill_date?: string
          bill_number?: string | null
          calc_snapshot?: Json | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          current_charges?: number | null
          cycle_config_id?: string | null
          due_date: string
          finalized_at?: string | null
          flat_id: string
          generated_by?: string | null
          generation_batch_id?: string | null
          id?: string
          last_decay_date?: string | null
          notes?: string | null
          paid_at?: string | null
          penalties?: number
          period_end: string
          period_label: string
          period_start: string
          previous_balance?: number
          replaced_by_bill_id?: string | null
          society_id: string
          status?: string
          tax_amount?: number
          template_id?: string | null
          total_payable?: number | null
          updated_at?: string
        }
        Update: {
          adjustments?: number
          amount?: number
          bill_date?: string
          bill_number?: string | null
          calc_snapshot?: Json | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          current_charges?: number | null
          cycle_config_id?: string | null
          due_date?: string
          finalized_at?: string | null
          flat_id?: string
          generated_by?: string | null
          generation_batch_id?: string | null
          id?: string
          last_decay_date?: string | null
          notes?: string | null
          paid_at?: string | null
          penalties?: number
          period_end?: string
          period_label?: string
          period_start?: string
          previous_balance?: number
          replaced_by_bill_id?: string | null
          society_id?: string
          status?: string
          tax_amount?: number
          template_id?: string | null
          total_payable?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_cycle_config_id_fkey"
            columns: ["cycle_config_id"]
            isOneToOne: false
            referencedRelation: "billing_cycle_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_generation_batch_id_fkey"
            columns: ["generation_batch_id"]
            isOneToOne: false
            referencedRelation: "bill_generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_replaced_by_bill_id_fkey"
            columns: ["replaced_by_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "billing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          normalized_name: string | null
          society_id: string
          structure_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          normalized_name?: string | null
          society_id: string
          structure_kind?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          normalized_name?: string | null
          society_id?: string
          structure_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      community_digests: {
        Row: {
          created_at: string
          highlights: Json | null
          id: string
          society_id: string
          summary: string
          week_start: string
        }
        Insert: {
          created_at?: string
          highlights?: Json | null
          id?: string
          society_id: string
          summary: string
          week_start: string
        }
        Update: {
          created_at?: string
          highlights?: Json | null
          id?: string
          society_id?: string
          summary?: string
          week_start?: string
        }
        Relationships: []
      }
      community_event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          guests: number
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          guests?: number
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          guests?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "community_events"
            referencedColumns: ["id"]
          },
        ]
      }
      community_events: {
        Row: {
          cancel_reason: string | null
          capacity: number | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          society_id: string
          starts_at: string
          status: string
          title: string
          venue: string | null
        }
        Insert: {
          cancel_reason?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          society_id: string
          starts_at: string
          status?: string
          title: string
          venue?: string | null
        }
        Update: {
          cancel_reason?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          society_id?: string
          starts_at?: string
          status?: string
          title?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_events_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      community_group_members: {
        Row: {
          created_at: string
          group_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "community_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      community_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          join_policy: string
          kind: string
          name: string
          society_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          join_policy?: string
          kind?: string
          name: string
          society_id: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          join_policy?: string
          kind?: string
          name?: string
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_groups_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      community_listing_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          society_id: string | null
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          society_id?: string | null
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          society_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_listing_categories_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      community_listing_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          listing_id: string
          reason: string | null
          society_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: number
          listing_id: string
          reason?: string | null
          society_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: number
          listing_id?: string
          reason?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "community_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      community_listing_reports: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          reason: string
          reporter_id: string
          society_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          reason: string
          reporter_id: string
          society_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          reason?: string
          reporter_id?: string
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_listing_reports_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "community_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      community_listings: {
        Row: {
          category_id: string | null
          contact_link: string | null
          contact_method: string
          contact_phone: string | null
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          image_path: string | null
          kind: string
          owner_id: string
          price_inr: number | null
          removed_by: string | null
          removed_reason: string | null
          report_count: number
          society_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          contact_link?: string | null
          contact_method?: string
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          image_path?: string | null
          kind?: string
          owner_id: string
          price_inr?: number | null
          removed_by?: string | null
          removed_reason?: string | null
          report_count?: number
          society_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          contact_link?: string | null
          contact_method?: string
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          image_path?: string | null
          kind?: string
          owner_id?: string
          price_inr?: number | null
          removed_by?: string | null
          removed_reason?: string | null
          report_count?: number
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "community_listing_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_listings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_values: {
        Row: {
          created_at: string
          field_id: string
          file_path: string | null
          id: string
          society_id: string
          updated_at: string
          user_id: string
          value: Json | null
        }
        Insert: {
          created_at?: string
          field_id: string
          file_path?: string | null
          id?: string
          society_id: string
          updated_at?: string
          user_id: string
          value?: Json | null
        }
        Update: {
          created_at?: string
          field_id?: string
          file_path?: string | null
          id?: string
          society_id?: string
          updated_at?: string
          user_id?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_values_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string
          field_type: string
          id: string
          key: string
          label: string
          options: Json | null
          required: boolean
          society_id: string
          sort_order: number
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          field_type: string
          id?: string
          key: string
          label: string
          options?: Json | null
          required?: boolean
          society_id: string
          sort_order?: number
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          field_type?: string
          id?: string
          key?: string
          label?: string
          options?: Json | null
          required?: boolean
          society_id?: string
          sort_order?: number
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_plans: {
        Row: {
          applied_at: string | null
          created_at: string
          created_by: string | null
          duration_days: number
          id: string
          name: string
          notes: string | null
          platform_fee_percent: number
          price_inr: number
          society_id: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          created_by?: string | null
          duration_days: number
          id?: string
          name: string
          notes?: string | null
          platform_fee_percent?: number
          price_inr: number
          society_id: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          created_by?: string | null
          duration_days?: number
          id?: string
          name?: string
          notes?: string | null
          platform_fee_percent?: number
          price_inr?: number
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_plans_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_expiry_reminders: {
        Row: {
          expires_on: string
          id: string
          recipients: number
          sent_at: string
          society_id: string
          source_id: string
          threshold: string
        }
        Insert: {
          expires_on: string
          id?: string
          recipients?: number
          sent_at?: string
          society_id: string
          source_id: string
          threshold: string
        }
        Update: {
          expires_on?: string
          id?: string
          recipients?: number
          sent_at?: string
          society_id?: string
          source_id?: string
          threshold?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_expiry_reminders_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "society_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      election_ballot_choices: {
        Row: {
          election_id: string
          id: string
          nomination_id: string
          open_voter_id: string | null
          post_id: string
        }
        Insert: {
          election_id: string
          id?: string
          nomination_id: string
          open_voter_id?: string | null
          post_id: string
        }
        Update: {
          election_id?: string
          id?: string
          nomination_id?: string
          open_voter_id?: string | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_ballot_choices_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_ballot_choices_nomination_id_fkey"
            columns: ["nomination_id"]
            isOneToOne: false
            referencedRelation: "election_nominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_ballot_choices_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "election_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      election_nominations: {
        Row: {
          candidate_id: string
          candidate_name: string
          created_at: string
          election_id: string
          id: string
          post_id: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          society_id: string
          statement: string | null
          status: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          candidate_name: string
          created_at?: string
          election_id: string
          id?: string
          post_id: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id: string
          statement?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          candidate_name?: string
          created_at?: string
          election_id?: string
          id?: string
          post_id?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id?: string
          statement?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_nominations_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_nominations_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "election_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_nominations_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      election_posts: {
        Row: {
          candidate_rule: string
          description: string | null
          election_id: string
          id: string
          name: string
          requirements: string | null
          seats: number
          seq: number
          society_id: string
        }
        Insert: {
          candidate_rule?: string
          description?: string | null
          election_id: string
          id?: string
          name: string
          requirements?: string | null
          seats?: number
          seq?: number
          society_id: string
        }
        Update: {
          candidate_rule?: string
          description?: string | null
          election_id?: string
          id?: string
          name?: string
          requirements?: string | null
          seats?: number
          seq?: number
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_posts_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_posts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      election_voters: {
        Row: {
          election_id: string
          flat_id: string | null
          request_id: string
          user_id: string
          voted_on: string
        }
        Insert: {
          election_id: string
          flat_id?: string | null
          request_id: string
          user_id: string
          voted_on?: string
        }
        Update: {
          election_id?: string
          flat_id?: string | null
          request_id?: string
          user_id?: string
          voted_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_voters_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      elections: {
        Row: {
          agm_id: string | null
          archive_reason: string | null
          created_at: string
          created_by: string
          eligibility: string
          id: string
          instructions: string | null
          nomination_closes_at: string
          nomination_opens_at: string
          purpose: string
          results: Json | null
          results_hash: string | null
          results_published_at: string | null
          rules_source_id: string | null
          secret_ballot: boolean
          society_id: string
          status: string
          title: string
          updated_at: string
          voting_closes_at: string
          voting_opens_at: string
        }
        Insert: {
          agm_id?: string | null
          archive_reason?: string | null
          created_at?: string
          created_by: string
          eligibility?: string
          id?: string
          instructions?: string | null
          nomination_closes_at: string
          nomination_opens_at: string
          purpose?: string
          results?: Json | null
          results_hash?: string | null
          results_published_at?: string | null
          rules_source_id?: string | null
          secret_ballot?: boolean
          society_id: string
          status?: string
          title: string
          updated_at?: string
          voting_closes_at: string
          voting_opens_at: string
        }
        Update: {
          agm_id?: string | null
          archive_reason?: string | null
          created_at?: string
          created_by?: string
          eligibility?: string
          id?: string
          instructions?: string | null
          nomination_closes_at?: string
          nomination_opens_at?: string
          purpose?: string
          results?: Json | null
          results_hash?: string | null
          results_published_at?: string | null
          rules_source_id?: string | null
          secret_ballot?: boolean
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
          voting_closes_at?: string
          voting_opens_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "elections_agm_fk"
            columns: ["agm_id"]
            isOneToOne: false
            referencedRelation: "agms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elections_rules_source_id_fkey"
            columns: ["rules_source_id"]
            isOneToOne: false
            referencedRelation: "society_knowledge_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elections_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_broadcast_recipients: {
        Row: {
          acknowledged_at: string | null
          broadcast_id: string
          notified: boolean
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          broadcast_id: string
          notified?: boolean
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          broadcast_id?: string
          notified?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "emergency_broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_broadcasts: {
        Row: {
          audience: string
          block_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category_id: string | null
          category_label: string
          channel_status: Json
          created_at: string
          created_by: string
          expires_at: string
          id: string
          in_app_delivered: number
          message: string
          recipient_count: number
          request_id: string
          society_id: string
          sos_alert_id: string | null
          title: string
        }
        Insert: {
          audience: string
          block_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          category_label: string
          channel_status?: Json
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          in_app_delivered?: number
          message: string
          recipient_count?: number
          request_id: string
          society_id: string
          sos_alert_id?: string | null
          title: string
        }
        Update: {
          audience?: string
          block_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          category_label?: string
          channel_status?: Json
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          in_app_delivered?: number
          message?: string
          recipient_count?: number
          request_id?: string
          society_id?: string
          sos_alert_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_broadcasts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "emergency_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_broadcasts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_broadcasts_sos_alert_id_fkey"
            columns: ["sos_alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          society_id: string | null
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          society_id?: string | null
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          society_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "emergency_categories_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      ev_chargers: {
        Row: {
          connector: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          provider: string
          rated_kw: number | null
          slot_id: string | null
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          connector?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          provider?: string
          rated_kw?: number | null
          slot_id?: string | null
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          connector?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          provider?: string
          rated_kw?: number | null
          slot_id?: string | null
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ev_chargers_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "parking_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ev_chargers_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      ev_charging_sessions: {
        Row: {
          charger_id: string
          created_at: string
          ended_at: string | null
          ended_by: string | null
          energy_kwh: number | null
          energy_source: string | null
          flat_id: string | null
          id: string
          note: string | null
          society_id: string
          started_at: string
          started_by: string
          status: string
          vehicle_id: string
        }
        Insert: {
          charger_id: string
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          energy_kwh?: number | null
          energy_source?: string | null
          flat_id?: string | null
          id?: string
          note?: string | null
          society_id: string
          started_at?: string
          started_by: string
          status?: string
          vehicle_id: string
        }
        Update: {
          charger_id?: string
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          energy_kwh?: number | null
          energy_source?: string | null
          flat_id?: string | null
          id?: string
          note?: string | null
          society_id?: string
          started_at?: string
          started_by?: string
          status?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ev_charging_sessions_charger_id_fkey"
            columns: ["charger_id"]
            isOneToOne: false
            referencedRelation: "ev_chargers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ev_charging_sessions_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ev_charging_sessions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ev_charging_sessions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_tax_calculations: {
        Row: {
          amount_includes_gst: boolean
          calc_version: number
          calculated_at: string
          calculated_by: string
          cgst: number | null
          expense_id: string
          gross_amount: number
          gst_rate: number | null
          id: string
          igst: number | null
          inputs: Json
          missing: string[]
          net_payable: number | null
          sgst: number | null
          society_id: string
          status: string
          supply_type: string | null
          taxable_amount: number | null
          tds_amount: number | null
          tds_applicable: boolean | null
          tds_rate: number | null
          tds_section: string | null
          total_gst: number | null
        }
        Insert: {
          amount_includes_gst?: boolean
          calc_version?: number
          calculated_at?: string
          calculated_by: string
          cgst?: number | null
          expense_id: string
          gross_amount: number
          gst_rate?: number | null
          id?: string
          igst?: number | null
          inputs: Json
          missing?: string[]
          net_payable?: number | null
          sgst?: number | null
          society_id: string
          status: string
          supply_type?: string | null
          taxable_amount?: number | null
          tds_amount?: number | null
          tds_applicable?: boolean | null
          tds_rate?: number | null
          tds_section?: string | null
          total_gst?: number | null
        }
        Update: {
          amount_includes_gst?: boolean
          calc_version?: number
          calculated_at?: string
          calculated_by?: string
          cgst?: number | null
          expense_id?: string
          gross_amount?: number
          gst_rate?: number | null
          id?: string
          igst?: number | null
          inputs?: Json
          missing?: string[]
          net_payable?: number | null
          sgst?: number | null
          society_id?: string
          status?: string
          supply_type?: string | null
          taxable_amount?: number | null
          tds_amount?: number | null
          tds_applicable?: boolean | null
          tds_rate?: number | null
          tds_section?: string | null
          total_gst?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_tax_calculations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_tax_calculations_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          note: string | null
          payment_method: string | null
          request_id: string | null
          reversal_journal_entry_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          society_id: string
          spent_on: string
          status: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          note?: string | null
          payment_method?: string | null
          request_id?: string | null
          reversal_journal_entry_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          society_id: string
          spent_on?: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          note?: string | null
          payment_method?: string | null
          request_id?: string | null
          reversal_journal_entry_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          society_id?: string
          spent_on?: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          age: number | null
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          flat_id: string | null
          full_name: string
          id: string
          is_active: boolean
          offline_resident_id: string | null
          phone: string | null
          relation: string
          society_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          age?: number | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          flat_id?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          offline_resident_id?: string | null
          phone?: string | null
          relation: string
          society_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          age?: number | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          flat_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          offline_resident_id?: string | null
          phone?: string | null
          relation?: string
          society_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_members_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_offline_resident_id_fkey"
            columns: ["offline_resident_id"]
            isOneToOne: false
            referencedRelation: "offline_residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      fcm_tokens: {
        Row: {
          created_at: string
          device_info: string | null
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: string | null
          id?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: string | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          normal_balance: string
          society_id: string
          system_key: string | null
          updated_at: string
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          normal_balance: string
          society_id: string
          system_key?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          normal_balance?: string
          society_id?: string
          system_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_accounts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_backfill_requests: {
        Row: {
          created_at: string
          request_id: string
          requested_by: string
          result: Json
          society_id: string
        }
        Insert: {
          created_at?: string
          request_id: string
          requested_by: string
          result: Json
          society_id: string
        }
        Update: {
          created_at?: string
          request_id?: string
          requested_by?: string
          result?: Json
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_backfill_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_fiscal_years: {
        Row: {
          close_snapshot: Json | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          fy_end: string
          fy_start: string
          id: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          close_snapshot?: Json | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          fy_end: string
          fy_start: string
          id?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          close_snapshot?: Json | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          fy_end?: string
          fy_start?: string
          id?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_fiscal_years_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_journal_entries: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          journal_no: string | null
          posted_at: string | null
          reference: string | null
          reversal_of: string | null
          society_id: string
          source_action: string
          source_id: string
          source_type: string
          status: string
          transaction_date: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by: string
          description: string
          id?: string
          journal_no?: string | null
          posted_at?: string | null
          reference?: string | null
          reversal_of?: string | null
          society_id: string
          source_action?: string
          source_id: string
          source_type: string
          status?: string
          transaction_date: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          journal_no?: string | null
          posted_at?: string | null
          reference?: string | null
          reversal_of?: string | null
          society_id?: string
          source_action?: string
          source_id?: string
          source_type?: string
          status?: string
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_entries_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_journal_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          description: string | null
          id: string
          journal_entry_id: string
          line_number: number
          society_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id: string
          line_number: number
          society_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
          line_number?: number
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_lines_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_journal_sequences: {
        Row: {
          fy_start: string
          last_no: number
          society_id: string
        }
        Insert: {
          fy_start: string
          last_no?: number
          society_id: string
        }
        Update: {
          fy_start?: string
          last_no?: number
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_sequences_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_vendor_tax: {
        Row: {
          gst_rate: number | null
          gstin: string | null
          pan: string | null
          society_id: string
          state_code: string | null
          tds_rate: number | null
          tds_section: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          gst_rate?: number | null
          gstin?: string | null
          pan?: string | null
          society_id: string
          state_code?: string | null
          tds_rate?: number | null
          tds_section?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          gst_rate?: number | null
          gstin?: string | null
          pan?: string | null
          society_id?: string
          state_code?: string | null
          tds_rate?: number | null
          tds_section?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_vendor_tax_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_vendor_tax_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: true
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_vendors: {
        Row: {
          category: string | null
          contract_end: string | null
          contract_notes: string | null
          contract_start: string | null
          contract_type: string
          contract_value: number | null
          created_at: string
          created_by: string
          deactivated_at: string | null
          deactivated_by: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          society_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          contract_end?: string | null
          contract_notes?: string | null
          contract_start?: string | null
          contract_type?: string
          contract_value?: number | null
          created_at?: string
          created_by: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          society_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          contract_end?: string | null
          contract_notes?: string | null
          contract_start?: string | null
          contract_type?: string
          contract_value?: number | null
          created_at?: string
          created_by?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_vendors_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      flat_pets: {
        Row: {
          added_by: string
          breed: string | null
          created_at: string
          flat_id: string
          id: string
          is_active: boolean
          name: string
          removed_at: string | null
          society_id: string
          species: string
          vaccinated_until: string | null
        }
        Insert: {
          added_by: string
          breed?: string | null
          created_at?: string
          flat_id: string
          id?: string
          is_active?: boolean
          name: string
          removed_at?: string | null
          society_id: string
          species: string
          vaccinated_until?: string | null
        }
        Update: {
          added_by?: string
          breed?: string | null
          created_at?: string
          flat_id?: string
          id?: string
          is_active?: boolean
          name?: string
          removed_at?: string | null
          society_id?: string
          species?: string
          vaccinated_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flat_pets_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flat_pets_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      flat_residents: {
        Row: {
          access_expires_at: string | null
          archived_at: string | null
          created_at: string
          ended_reason: string | null
          flat_id: string
          id: string
          invited_at: string | null
          is_active: boolean
          is_primary: boolean
          lease_ends_on: string | null
          lease_starts_on: string | null
          move_out_override_reason: string | null
          moved_in_at: string | null
          moved_out_at: string | null
          notice_given_on: string | null
          relationship: string
          renewal_count: number
          renewed_at: string | null
          termination_kind: string | null
          user_id: string
        }
        Insert: {
          access_expires_at?: string | null
          archived_at?: string | null
          created_at?: string
          ended_reason?: string | null
          flat_id: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          is_primary?: boolean
          lease_ends_on?: string | null
          lease_starts_on?: string | null
          move_out_override_reason?: string | null
          moved_in_at?: string | null
          moved_out_at?: string | null
          notice_given_on?: string | null
          relationship?: string
          renewal_count?: number
          renewed_at?: string | null
          termination_kind?: string | null
          user_id: string
        }
        Update: {
          access_expires_at?: string | null
          archived_at?: string | null
          created_at?: string
          ended_reason?: string | null
          flat_id?: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          is_primary?: boolean
          lease_ends_on?: string | null
          lease_starts_on?: string | null
          move_out_override_reason?: string | null
          moved_in_at?: string | null
          moved_out_at?: string | null
          notice_given_on?: string | null
          relationship?: string
          renewal_count?: number
          renewed_at?: string | null
          termination_kind?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flat_residents_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
        ]
      }
      flat360_ai_summary_cache: {
        Row: {
          created_at: string
          expires_at: string
          flat_id: string
          generated_at: string
          id: string
          result_json: Json
          schema_version: number
          snapshot_fingerprint: string
          society_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          flat_id: string
          generated_at?: string
          id?: string
          result_json: Json
          schema_version: number
          snapshot_fingerprint: string
          society_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          flat_id?: string
          generated_at?: string
          id?: string
          result_json?: Json
          schema_version?: number
          snapshot_fingerprint?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flat360_ai_summary_cache_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flat360_ai_summary_cache_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      flats: {
        Row: {
          area_sqft: number | null
          block_id: string | null
          created_at: string
          display_order: number
          flat_number: string
          floor: number | null
          id: string
          is_active: boolean
          normalized_label: string | null
          society_id: string
          status: string
          type: string | null
          unit_type: string
          updated_at: string
        }
        Insert: {
          area_sqft?: number | null
          block_id?: string | null
          created_at?: string
          display_order?: number
          flat_number: string
          floor?: number | null
          id?: string
          is_active?: boolean
          normalized_label?: string | null
          society_id: string
          status?: string
          type?: string | null
          unit_type?: string
          updated_at?: string
        }
        Update: {
          area_sqft?: number | null
          block_id?: string | null
          created_at?: string
          display_order?: number
          flat_number?: string
          floor?: number | null
          id?: string
          is_active?: boolean
          normalized_label?: string | null
          society_id?: string
          status?: string
          type?: string | null
          unit_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flats_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flats_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_devices: {
        Row: {
          created_at: string
          created_by: string | null
          gate_label: string | null
          id: string
          key_hash: string | null
          kind: string
          last_error: string | null
          last_seen_at: string | null
          name: string
          provider: string | null
          society_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          gate_label?: string | null
          id?: string
          key_hash?: string | null
          kind: string
          last_error?: string | null
          last_seen_at?: string | null
          name: string
          provider?: string | null
          society_id: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          gate_label?: string | null
          id?: string
          key_hash?: string | null
          kind?: string
          last_error?: string | null
          last_seen_at?: string | null
          name?: string
          provider?: string | null
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_devices_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_hardware_events: {
        Row: {
          confidence: number | null
          created_at: string
          device_id: string
          external_event_id: string
          id: string
          kind: string
          occurred_at: string
          plate: string | null
          result: string
          review_decision: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rfid_credential_id: string | null
          society_id: string
          vehicle_id: string | null
          visitor_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          device_id: string
          external_event_id: string
          id?: string
          kind: string
          occurred_at: string
          plate?: string | null
          result: string
          review_decision?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rfid_credential_id?: string | null
          society_id: string
          vehicle_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          device_id?: string
          external_event_id?: string
          id?: string
          kind?: string
          occurred_at?: string
          plate?: string | null
          result?: string
          review_decision?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rfid_credential_id?: string | null
          society_id?: string
          vehicle_id?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gate_hardware_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "gate_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_hardware_events_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_offline_ops: {
        Row: {
          actor_id: string
          created_at: string
          kind: string
          op_id: string
          result: Json
          society_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          kind: string
          op_id: string
          result: Json
          society_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          kind?: string
          op_id?: string
          result?: Json
          society_id?: string
        }
        Relationships: []
      }
      guard_entry_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          guard_user_id: string
          id: string
          revoked_at: string | null
          society_id: string
          token_hash: string
          used_at: string | null
          used_session_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          guard_user_id: string
          id?: string
          revoked_at?: string | null
          society_id: string
          token_hash: string
          used_at?: string | null
          used_session_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          guard_user_id?: string
          id?: string
          revoked_at?: string | null
          society_id?: string
          token_hash?: string
          used_at?: string | null
          used_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guard_entry_tokens_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      guard_reauth_blocks: {
        Row: {
          set_at: string
          set_by: string | null
          society_id: string
          user_id: string
        }
        Insert: {
          set_at?: string
          set_by?: string | null
          society_id: string
          user_id: string
        }
        Update: {
          set_at?: string
          set_by?: string | null
          society_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guard_reauth_blocks_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      guard_sessions: {
        Row: {
          auth_session_id: string
          device_label: string | null
          ended_at: string | null
          entry_token_id: string | null
          expires_at: string
          id: string
          last_seen_at: string
          method: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          society_id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          auth_session_id: string
          device_label?: string | null
          ended_at?: string | null
          entry_token_id?: string | null
          expires_at?: string
          id?: string
          last_seen_at?: string
          method: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          society_id: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          auth_session_id?: string
          device_label?: string | null
          ended_at?: string | null
          entry_token_id?: string | null
          expires_at?: string
          id?: string
          last_seen_at?: string
          method?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          society_id?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guard_sessions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      hierarchy_nodes: {
        Row: {
          code: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["hierarchy_kind"]
          legacy_block_id: string | null
          legacy_flat_id: string | null
          meta: Json
          name: string
          parent_id: string | null
          society_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["hierarchy_kind"]
          legacy_block_id?: string | null
          legacy_flat_id?: string | null
          meta?: Json
          name: string
          parent_id?: string | null
          society_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["hierarchy_kind"]
          legacy_block_id?: string | null
          legacy_flat_id?: string | null
          meta?: Json
          name?: string
          parent_id?: string | null
          society_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hierarchy_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "hierarchy_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hierarchy_nodes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          flat_id: string
          id: string
          method: string
          payment_date: string
          receipt_ref: string | null
          reference_no: string | null
          request_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          row_number: number
          society_id: string
          source_ref: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          flat_id: string
          id?: string
          method: string
          payment_date: string
          receipt_ref?: string | null
          reference_no?: string | null
          request_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_number: number
          society_id: string
          source_ref?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          flat_id?: string
          id?: string
          method?: string
          payment_date?: string
          receipt_ref?: string | null
          reference_no?: string | null
          request_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_number?: number
          society_id?: string
          source_ref?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_payments_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_payments_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          location: string | null
          name: string
          quantity: number
          reorder_level: number
          society_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          quantity?: number
          reorder_level?: number
          society_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          quantity?: number
          reorder_level?: number
          society_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          item_id: string
          reason: string
          resulting_qty: number
          society_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          item_id: string
          reason: string
          resulting_qty: number
          society_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          item_id?: string
          reason?: string
          resulting_qty?: number
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_extractions: {
        Row: {
          corrections: Json | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          error_code: string | null
          expense_id: string | null
          extracted: Json | null
          file_mime: string
          file_path: string
          file_size: number
          id: string
          invoice_number: string | null
          notes: string[]
          original_name: string
          procurement_request_id: string | null
          reject_reason: string | null
          society_id: string
          status: string
          updated_at: string
          uploaded_by: string
          vendor_gstin: string | null
        }
        Insert: {
          corrections?: Json | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          error_code?: string | null
          expense_id?: string | null
          extracted?: Json | null
          file_mime: string
          file_path: string
          file_size: number
          id?: string
          invoice_number?: string | null
          notes?: string[]
          original_name: string
          procurement_request_id?: string | null
          reject_reason?: string | null
          society_id: string
          status?: string
          updated_at?: string
          uploaded_by: string
          vendor_gstin?: string | null
        }
        Update: {
          corrections?: Json | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          error_code?: string | null
          expense_id?: string | null
          extracted?: Json | null
          file_mime?: string
          file_path?: string
          file_size?: number
          id?: string
          invoice_number?: string | null
          notes?: string[]
          original_name?: string
          procurement_request_id?: string | null
          reject_reason?: string | null
          society_id?: string
          status?: string
          updated_at?: string
          uploaded_by?: string
          vendor_gstin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_extractions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_extractions_procurement_request_id_fkey"
            columns: ["procurement_request_id"]
            isOneToOne: false
            referencedRelation: "procurement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_extractions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      join_requests: {
        Row: {
          created_at: string
          flat_id: string | null
          flat_number_input: string | null
          full_name: string | null
          id: string
          mobile: string | null
          owner_or_tenant: string | null
          reason: string | null
          relationship: string
          reviewed_at: string | null
          reviewer_id: string | null
          society_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          flat_id?: string | null
          flat_number_input?: string | null
          full_name?: string | null
          id?: string
          mobile?: string | null
          owner_or_tenant?: string | null
          reason?: string | null
          relationship: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          society_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          flat_id?: string | null
          flat_number_input?: string | null
          full_name?: string | null
          id?: string
          mobile?: string | null
          owner_or_tenant?: string | null
          reason?: string | null
          relationship?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          society_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "join_requests_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          created_by: string
          description: string | null
          entry_date: string
          id: string
          kind: string
          society_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          entry_date?: string
          id?: string
          kind: string
          society_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          entry_date?: string
          id?: string
          kind?: string
          society_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_payment_events: {
        Row: {
          created_at: string
          event_type: string
          failure_code: string | null
          id: string
          order_id: string | null
          payload_sha256: string
          processed_at: string | null
          processing_status: string
          provider_event_id: string
          society_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          failure_code?: string | null
          id?: string
          order_id?: string | null
          payload_sha256: string
          processed_at?: string | null
          processing_status?: string
          provider_event_id: string
          society_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          failure_code?: string | null
          id?: string
          order_id?: string | null
          payload_sha256?: string
          processed_at?: string | null
          processing_status?: string
          provider_event_id?: string
          society_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_payment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_payment_orders: {
        Row: {
          amount_paise: number
          bill_id: string
          created_at: string
          currency: string
          failure_code: string | null
          flat_id: string
          id: string
          payment_id: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_note: string | null
          refund_reference: string | null
          refund_resolved_at: string | null
          refund_resolved_by: string | null
          request_id: string
          society_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_paise: number
          bill_id: string
          created_at?: string
          currency?: string
          failure_code?: string | null
          flat_id: string
          id?: string
          payment_id?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_note?: string | null
          refund_reference?: string | null
          refund_resolved_at?: string | null
          refund_resolved_by?: string | null
          request_id: string
          society_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_paise?: number
          bill_id?: string
          created_at?: string
          currency?: string
          failure_code?: string | null
          flat_id?: string
          id?: string
          payment_id?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_note?: string | null
          refund_reference?: string | null
          refund_resolved_at?: string | null
          refund_resolved_by?: string | null
          request_id?: string
          society_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_payment_orders_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_payment_orders_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_payment_orders_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_payment_orders_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_periods: {
        Row: {
          amount_due: number
          bill_id: string | null
          created_at: string
          due_date: string | null
          flat_id: string
          id: string
          paid_at: string | null
          period_end: string
          period_label: string
          period_start: string
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          bill_id?: string | null
          created_at?: string
          due_date?: string | null
          flat_id: string
          id?: string
          paid_at?: string | null
          period_end: string
          period_label: string
          period_start: string
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          bill_id?: string | null
          created_at?: string
          due_date?: string | null
          flat_id?: string
          id?: string
          paid_at?: string | null
          period_end?: string
          period_label?: string
          period_start?: string
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_periods_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_periods_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_periods_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_tasks: {
        Row: {
          asset_id: string | null
          cancel_reason: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          due_on: string
          id: string
          instructions: string | null
          society_id: string
          staff_id: string
          staff_note: string | null
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          cancel_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          due_on: string
          id?: string
          instructions?: string | null
          society_id: string
          staff_id: string
          staff_note?: string | null
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          cancel_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          due_on?: string
          id?: string
          instructions?: string | null
          society_id?: string
          staff_id?: string
          staff_note?: string | null
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_tasks_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "society_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_tasks_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_tasks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "society_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      material_passes: {
        Row: {
          checked_in_at: string | null
          checked_out_at: string | null
          contractor_name: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          description: string
          flat_id: string
          id: string
          kind: string
          lift_required: boolean
          requested_by: string
          society_id: string
          status: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          contractor_name?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description: string
          flat_id: string
          id?: string
          kind: string
          lift_required?: boolean
          requested_by: string
          society_id: string
          status?: string
          valid_from: string
          valid_until: string
        }
        Update: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          contractor_name?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description?: string
          flat_id?: string
          id?: string
          kind?: string
          lift_required?: boolean
          requested_by?: string
          society_id?: string
          status?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_passes_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_passes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_action_items: {
        Row: {
          created_at: string
          created_by: string
          due_on: string | null
          id: string
          meeting_id: string
          owner_name: string | null
          society_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          due_on?: string | null
          id?: string
          meeting_id: string
          owner_name?: string | null
          society_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          due_on?: string | null
          id?: string
          meeting_id?: string
          owner_name?: string | null
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_action_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_attendance: {
        Row: {
          meeting_id: string
          present: boolean
          recorded_at: string
          recorded_by: string
          user_id: string
        }
        Insert: {
          meeting_id: string
          present: boolean
          recorded_at?: string
          recorded_by: string
          user_id: string
        }
        Update: {
          meeting_id?: string
          present?: boolean
          recorded_at?: string
          recorded_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendance_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_documents: {
        Row: {
          added_at: string
          added_by: string
          meeting_id: string
          source_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          meeting_id: string
          source_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          meeting_id?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_documents_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "society_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_minutes_corrections: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          meeting_id: string
          reason: string
          society_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          id?: string
          meeting_id: string
          reason: string
          society_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          meeting_id?: string
          reason?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_minutes_corrections_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_resolutions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          meeting_id: string
          outcome: string
          poll_id: string | null
          seq: number
          society_id: string
          text: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          meeting_id: string
          outcome: string
          poll_id?: string | null
          seq: number
          society_id: string
          text: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          meeting_id?: string
          outcome?: string
          poll_id?: string | null
          seq?: number
          society_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_resolutions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_resolutions_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_rsvps: {
        Row: {
          meeting_id: string
          response: string
          updated_at: string
          user_id: string
        }
        Insert: {
          meeting_id: string
          response: string
          updated_at?: string
          user_id: string
        }
        Update: {
          meeting_id?: string
          response?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_rsvps_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          agenda: string
          audience: string
          cancel_reason: string | null
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          location: string | null
          meeting_link: string | null
          minutes: string | null
          reminded_at: string | null
          society_id: string
          starts_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agenda?: string
          audience?: string
          cancel_reason?: string | null
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          location?: string | null
          meeting_link?: string | null
          minutes?: string | null
          reminded_at?: string | null
          society_id: string
          starts_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agenda?: string
          audience?: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          location?: string | null
          meeting_link?: string | null
          minutes?: string | null
          reminded_at?: string | null
          society_id?: string
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      message_deliveries: {
        Row: {
          attempts: number
          body: string
          channel: string
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          next_attempt_at: string
          provider_message_id: string | null
          society_id: string | null
          source_id: string | null
          source_kind: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body: string
          channel: string
          created_at?: string
          dedupe_key: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          provider_message_id?: string | null
          society_id?: string | null
          source_id?: string | null
          source_kind: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          provider_message_id?: string | null
          society_id?: string | null
          source_id?: string | null
          source_kind?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_deliveries_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_channels: {
        Row: {
          channel: string
          enabled: boolean
          last_error: string | null
          last_health_at: string | null
          last_health_ok: boolean | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channel: string
          enabled?: boolean
          last_error?: string | null
          last_health_at?: string | null
          last_health_ok?: boolean | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channel?: string
          enabled?: boolean
          last_error?: string | null
          last_health_at?: string | null
          last_health_ok?: boolean | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      migration_commit_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          failed_at: string | null
          failure_code: string | null
          id: string
          job_id: string
          payload_hash: string
          request_id: string
          result_json: Json | null
          society_id: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          job_id: string
          payload_hash: string
          request_id: string
          result_json?: Json | null
          society_id: string
          status: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          job_id?: string
          payload_hash?: string
          request_id?: string
          result_json?: Json | null
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_commit_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "migration_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_commit_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_entity_links: {
        Row: {
          canonical_entity_id: string
          created_at: string
          entity_type: Database["public"]["Enums"]["migration_entity_type"]
          id: string
          job_id: string | null
          society_id: string
          source_checksum: string | null
          source_key: string
          source_type: string
        }
        Insert: {
          canonical_entity_id: string
          created_at?: string
          entity_type: Database["public"]["Enums"]["migration_entity_type"]
          id?: string
          job_id?: string | null
          society_id: string
          source_checksum?: string | null
          source_key: string
          source_type: string
        }
        Update: {
          canonical_entity_id?: string
          created_at?: string
          entity_type?: Database["public"]["Enums"]["migration_entity_type"]
          id?: string
          job_id?: string | null
          society_id?: string
          source_checksum?: string | null
          source_key?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_entity_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "migration_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_entity_links_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_jobs: {
        Row: {
          committed_at: string | null
          committed_rows: number
          created_at: string
          created_by: string
          error_rows: number
          failed_at: string | null
          failure_code: string | null
          file_checksum: string
          id: string
          idempotency_key: string | null
          mapping_json: Json
          retry_of_job_id: string | null
          rollback_reason: string | null
          rollback_summary: Json | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          society_id: string
          source_filename: string
          source_type: string
          status: Database["public"]["Enums"]["migration_job_status"]
          storage_path: string | null
          structure_mode: string | null
          total_rows: number
          updated_at: string
          valid_rows: number
          validated_at: string | null
          warning_rows: number
        }
        Insert: {
          committed_at?: string | null
          committed_rows?: number
          created_at?: string
          created_by: string
          error_rows?: number
          failed_at?: string | null
          failure_code?: string | null
          file_checksum: string
          id?: string
          idempotency_key?: string | null
          mapping_json?: Json
          retry_of_job_id?: string | null
          rollback_reason?: string | null
          rollback_summary?: Json | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          society_id: string
          source_filename: string
          source_type: string
          status?: Database["public"]["Enums"]["migration_job_status"]
          storage_path?: string | null
          structure_mode?: string | null
          total_rows?: number
          updated_at?: string
          valid_rows?: number
          validated_at?: string | null
          warning_rows?: number
        }
        Update: {
          committed_at?: string | null
          committed_rows?: number
          created_at?: string
          created_by?: string
          error_rows?: number
          failed_at?: string | null
          failure_code?: string | null
          file_checksum?: string
          id?: string
          idempotency_key?: string | null
          mapping_json?: Json
          retry_of_job_id?: string | null
          rollback_reason?: string | null
          rollback_summary?: Json | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          society_id?: string
          source_filename?: string
          source_type?: string
          status?: Database["public"]["Enums"]["migration_job_status"]
          storage_path?: string | null
          structure_mode?: string | null
          total_rows?: number
          updated_at?: string
          valid_rows?: number
          validated_at?: string | null
          warning_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "migration_jobs_retry_of_job_id_fkey"
            columns: ["retry_of_job_id"]
            isOneToOne: false
            referencedRelation: "migration_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_jobs_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_parsed_rows: {
        Row: {
          created_at: string
          id: string
          job_id: string
          parse_error_codes: string[]
          parse_status: string
          row_checksum: string
          row_number: number
          society_id: string
          values_json: Json
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          parse_error_codes?: string[]
          parse_status?: string
          row_checksum: string
          row_number: number
          society_id: string
          values_json?: Json
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          parse_error_codes?: string[]
          parse_status?: string
          row_checksum?: string
          row_number?: number
          society_id?: string
          values_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "migration_parsed_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "migration_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_parsed_rows_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_rows: {
        Row: {
          action: Database["public"]["Enums"]["migration_row_action"]
          created_at: string
          entity_type: Database["public"]["Enums"]["migration_entity_type"]
          error_codes: string[]
          held_action: string | null
          held_for_review: boolean
          held_status: string | null
          id: string
          job_id: string
          mapped_json: Json
          raw_json: Json
          resolved_entity_id: string | null
          row_checksum: string
          row_number: number
          society_id: string
          source_key: string | null
          status: Database["public"]["Enums"]["migration_row_status"]
          updated_at: string
          warning_codes: string[]
        }
        Insert: {
          action?: Database["public"]["Enums"]["migration_row_action"]
          created_at?: string
          entity_type: Database["public"]["Enums"]["migration_entity_type"]
          error_codes?: string[]
          held_action?: string | null
          held_for_review?: boolean
          held_status?: string | null
          id?: string
          job_id: string
          mapped_json?: Json
          raw_json?: Json
          resolved_entity_id?: string | null
          row_checksum: string
          row_number: number
          society_id: string
          source_key?: string | null
          status?: Database["public"]["Enums"]["migration_row_status"]
          updated_at?: string
          warning_codes?: string[]
        }
        Update: {
          action?: Database["public"]["Enums"]["migration_row_action"]
          created_at?: string
          entity_type?: Database["public"]["Enums"]["migration_entity_type"]
          error_codes?: string[]
          held_action?: string | null
          held_for_review?: boolean
          held_status?: string | null
          id?: string
          job_id?: string
          mapped_json?: Json
          raw_json?: Json
          resolved_entity_id?: string | null
          row_checksum?: string
          row_number?: number
          society_id?: string
          source_key?: string | null
          status?: Database["public"]["Enums"]["migration_row_status"]
          updated_at?: string
          warning_codes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "migration_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "migration_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_rows_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      no_dues_audit: {
        Row: {
          action: string
          actor_id: string | null
          certificate_id: string | null
          created_at: string
          id: string
          metadata: Json
          new_status: Database["public"]["Enums"]["no_dues_status"] | null
          previous_status: Database["public"]["Enums"]["no_dues_status"] | null
          request_id: string | null
          society_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          certificate_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          new_status?: Database["public"]["Enums"]["no_dues_status"] | null
          previous_status?: Database["public"]["Enums"]["no_dues_status"] | null
          request_id?: string | null
          society_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          certificate_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          new_status?: Database["public"]["Enums"]["no_dues_status"] | null
          previous_status?: Database["public"]["Enums"]["no_dues_status"] | null
          request_id?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_dues_audit_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "no_dues_certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_dues_audit_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "no_dues_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_dues_audit_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      no_dues_cert_counters: {
        Row: {
          last_seq: number
          society_id: string
          updated_at: string
          year: number
        }
        Insert: {
          last_seq?: number
          society_id: string
          updated_at?: string
          year?: number
        }
        Update: {
          last_seq?: number
          society_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "no_dues_cert_counters_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      no_dues_certificates: {
        Row: {
          certificate_number: string
          created_at: string
          flat_id: string
          id: string
          issued_at: string
          issued_by: string
          request_id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          society_id: string
          storage_path: string
          token_storage_version: number | null
          updated_at: string
          valid_until: string | null
          verification_token: string | null
          verification_token_ciphertext: string | null
          verification_token_hash: string | null
          verification_token_iv: string | null
          verification_token_key_version: number | null
        }
        Insert: {
          certificate_number: string
          created_at?: string
          flat_id: string
          id?: string
          issued_at?: string
          issued_by: string
          request_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          society_id: string
          storage_path: string
          token_storage_version?: number | null
          updated_at?: string
          valid_until?: string | null
          verification_token?: string | null
          verification_token_ciphertext?: string | null
          verification_token_hash?: string | null
          verification_token_iv?: string | null
          verification_token_key_version?: number | null
        }
        Update: {
          certificate_number?: string
          created_at?: string
          flat_id?: string
          id?: string
          issued_at?: string
          issued_by?: string
          request_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          society_id?: string
          storage_path?: string
          token_storage_version?: number | null
          updated_at?: string
          valid_until?: string | null
          verification_token?: string | null
          verification_token_ciphertext?: string | null
          verification_token_hash?: string | null
          verification_token_iv?: string | null
          verification_token_key_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "no_dues_certificates_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_dues_certificates_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "no_dues_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_dues_certificates_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      no_dues_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          eligibility_snapshot: Json
          flat_id: string
          id: string
          purpose: string | null
          rejection_reason: string | null
          requester_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          society_id: string
          status: Database["public"]["Enums"]["no_dues_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          eligibility_snapshot?: Json
          flat_id: string
          id?: string
          purpose?: string | null
          rejection_reason?: string | null
          requester_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id: string
          status?: Database["public"]["Enums"]["no_dues_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          eligibility_snapshot?: Json
          flat_id?: string
          id?: string
          purpose?: string | null
          rejection_reason?: string | null
          requester_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id?: string
          status?: Database["public"]["Enums"]["no_dues_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_dues_requests_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_dues_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      non_member_payers: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_name: string | null
          payer_type: string
          phone: string | null
          reference_code: string | null
          society_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name: string
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_name?: string | null
          payer_type: string
          phone?: string | null
          reference_code?: string | null
          society_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_name?: string | null
          payer_type?: string
          phone?: string | null
          reference_code?: string | null
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "non_member_payers_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_acks: {
        Row: {
          acked_at: string
          notice_id: string
          user_id: string
        }
        Insert: {
          acked_at?: string
          notice_id: string
          user_id: string
        }
        Update: {
          acked_at?: string
          notice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_acks_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reads: {
        Row: {
          notice_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notice_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notice_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_reads_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          audience: string
          block_id: string | null
          body: string
          category: string
          created_at: string
          created_by: string
          edited_at: string | null
          expires_at: string | null
          id: string
          notified_at: string | null
          notified_count: number
          priority: string
          publish_at: string | null
          published_at: string | null
          requires_ack: boolean
          society_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          block_id?: string | null
          body: string
          category?: string
          created_at?: string
          created_by: string
          edited_at?: string | null
          expires_at?: string | null
          id?: string
          notified_at?: string | null
          notified_count?: number
          priority?: string
          publish_at?: string | null
          published_at?: string | null
          requires_ack?: boolean
          society_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          block_id?: string | null
          body?: string
          category?: string
          created_at?: string
          created_by?: string
          edited_at?: string | null
          expires_at?: string | null
          id?: string
          notified_at?: string | null
          notified_count?: number
          priority?: string
          publish_at?: string | null
          published_at?: string | null
          requires_ack?: boolean
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_residents: {
        Row: {
          created_at: string
          email: string | null
          flat_id: string
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          society_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          flat_id: string
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          society_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          flat_id?: string
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_residents_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_residents_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_balances: {
        Row: {
          amount: number
          as_of: string
          carried_bill_id: string | null
          created_at: string
          created_by: string
          flat_id: string
          id: string
          request_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          society_id: string
          source: string
          source_ref: string | null
          status: string
        }
        Insert: {
          amount: number
          as_of: string
          carried_bill_id?: string | null
          created_at?: string
          created_by: string
          flat_id: string
          id?: string
          request_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id: string
          source?: string
          source_ref?: string | null
          status?: string
        }
        Update: {
          amount?: number
          as_of?: string
          carried_bill_id?: string | null
          created_at?: string
          created_by?: string
          flat_id?: string
          id?: string
          request_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id?: string
          source?: string
          source_ref?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_balances_carried_bill_id_fkey"
            columns: ["carried_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_balances_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_balances_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_reminders_sent: {
        Row: {
          kind: string
          ref_date: string
          ref_id: string
          sent_at: string
        }
        Insert: {
          kind: string
          ref_date: string
          ref_id: string
          sent_at?: string
        }
        Update: {
          kind?: string
          ref_date?: string
          ref_id?: string
          sent_at?: string
        }
        Relationships: []
      }
      parking_allocations: {
        Row: {
          created_at: string
          ends_at: string | null
          flat_id: string | null
          id: string
          issued_by: string | null
          kind: string
          reason: string | null
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          slot_id: string
          society_id: string
          starts_at: string
          status: string
          temp_purpose: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          flat_id?: string | null
          id?: string
          issued_by?: string | null
          kind: string
          reason?: string | null
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          slot_id: string
          society_id: string
          starts_at?: string
          status?: string
          temp_purpose?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          flat_id?: string | null
          id?: string
          issued_by?: string | null
          kind?: string
          reason?: string | null
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          slot_id?: string
          society_id?: string
          starts_at?: string
          status?: string
          temp_purpose?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parking_allocations_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_allocations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "parking_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_allocations_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_allocations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_slots: {
        Row: {
          availability: string
          block_id: string | null
          created_at: string
          ev_capable: boolean
          flat_id: string | null
          floor: string | null
          id: string
          is_active: boolean
          label: string
          notes: string | null
          slot_type: string
          society_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          availability?: string
          block_id?: string | null
          created_at?: string
          ev_capable?: boolean
          flat_id?: string | null
          floor?: string | null
          id?: string
          is_active?: boolean
          label: string
          notes?: string | null
          slot_type?: string
          society_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          availability?: string
          block_id?: string | null
          created_at?: string
          ev_capable?: boolean
          flat_id?: string | null
          floor?: string | null
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
          slot_type?: string
          society_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parking_slots_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_slots_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_slots_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_slots_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_violation_evidence: {
        Row: {
          created_at: string
          id: string
          mime: string
          path: string
          remove_reason: string | null
          removed_at: string | null
          removed_by: string | null
          size_bytes: number
          society_id: string
          uploaded_by: string
          violation_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime: string
          path: string
          remove_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          size_bytes: number
          society_id: string
          uploaded_by: string
          violation_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime?: string
          path?: string
          remove_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          size_bytes?: number
          society_id?: string
          uploaded_by?: string
          violation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_violation_evidence_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_violation_evidence_violation_id_fkey"
            columns: ["violation_id"]
            isOneToOne: false
            referencedRelation: "parking_violations"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_violations: {
        Row: {
          created_at: string
          description: string | null
          flat_id: string | null
          id: string
          location: string | null
          occurred_at: string
          plate_text: string | null
          reported_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          slot_id: string | null
          society_id: string
          status: string
          updated_at: string
          vehicle_id: string | null
          violation_type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          flat_id?: string | null
          id?: string
          location?: string | null
          occurred_at?: string
          plate_text?: string | null
          reported_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          slot_id?: string | null
          society_id: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          violation_type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          flat_id?: string | null
          id?: string
          location?: string | null
          occurred_at?: string
          plate_text?: string | null
          reported_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          slot_id?: string | null
          society_id?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          violation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_violations_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_violations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "parking_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_violations_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parking_violations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_checkpoints: {
        Row: {
          code_hash: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          route_id: string
          society_id: string
        }
        Insert: {
          code_hash?: string | null
          id?: string
          is_active?: boolean
          name: string
          position: number
          route_id: string
          society_id: string
        }
        Update: {
          code_hash?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          route_id?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_checkpoints_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_checkpoints_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_round_checkpoints: {
        Row: {
          checkpoint_id: string
          completed_at: string | null
          completed_by: string | null
          incident_id: string | null
          location_evidence: Json | null
          note: string | null
          position: number
          round_id: string
          society_id: string
          status: string
          verification: string | null
        }
        Insert: {
          checkpoint_id: string
          completed_at?: string | null
          completed_by?: string | null
          incident_id?: string | null
          location_evidence?: Json | null
          note?: string | null
          position: number
          round_id: string
          society_id: string
          status?: string
          verification?: string | null
        }
        Update: {
          checkpoint_id?: string
          completed_at?: string | null
          completed_by?: string | null
          incident_id?: string | null
          location_evidence?: Json | null
          note?: string | null
          position?: number
          round_id?: string
          society_id?: string
          status?: string
          verification?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patrol_round_checkpoints_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "patrol_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_round_checkpoints_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "patrol_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_rounds: {
        Row: {
          assigned_guard: string
          created_at: string
          created_by: string | null
          due_by: string
          finished_at: string | null
          id: string
          missed_notified_at: string | null
          note: string | null
          route_id: string
          scheduled_start: string
          society_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          assigned_guard: string
          created_at?: string
          created_by?: string | null
          due_by: string
          finished_at?: string | null
          id?: string
          missed_notified_at?: string | null
          note?: string | null
          route_id: string
          scheduled_start: string
          society_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          assigned_guard?: string
          created_at?: string
          created_by?: string | null
          due_by?: string
          finished_at?: string | null
          id?: string
          missed_notified_at?: string | null
          note?: string | null
          route_id?: string
          scheduled_start?: string
          society_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_rounds_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_rounds_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_routes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          society_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          society_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_routes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipt_month_sequences: {
        Row: {
          next_number: number
          society_id: string
          updated_at: string
          year_month: number
        }
        Insert: {
          next_number?: number
          society_id: string
          updated_at?: string
          year_month: number
        }
        Update: {
          next_number?: number
          society_id?: string
          updated_at?: string
          year_month?: number
        }
        Relationships: []
      }
      payment_receipt_sequences: {
        Row: {
          next_number: number
          society_id: string
          updated_at: string
          year: number
        }
        Insert: {
          next_number?: number
          society_id: string
          updated_at?: string
          year: number
        }
        Update: {
          next_number?: number
          society_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      payment_receipts: {
        Row: {
          amount_snapshot: number | null
          bill_number_snapshot: string | null
          created_at: string
          id: string
          issued_at: string
          issued_by: string | null
          method_snapshot: string | null
          payment_id: string
          receipt_number: string
          reference_snapshot: string | null
          society_id: string
          status: string
          verified_at: string | null
          verified_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_snapshot?: number | null
          bill_number_snapshot?: string | null
          created_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          method_snapshot?: string | null
          payment_id: string
          receipt_number: string
          reference_snapshot?: string | null
          society_id: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_snapshot?: number | null
          bill_number_snapshot?: string | null
          created_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          method_snapshot?: string | null
          payment_id?: string
          receipt_number?: string
          reference_snapshot?: string | null
          society_id?: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bill_id: string
          created_at: string
          flat_id: string
          id: string
          idempotency_key: string | null
          journal_entry_id: string | null
          method: string
          notes: string | null
          paid_at: string
          payment_date: string | null
          platform_fee_paise: number | null
          platform_share_paise: number | null
          proof_url: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          reference_no: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reversal_journal_entry_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          society_id: string
          society_share_paise: number | null
          source: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          user_id: string | null
          verification_notes: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          bill_id: string
          created_at?: string
          flat_id: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          method?: string
          notes?: string | null
          paid_at?: string
          payment_date?: string | null
          platform_fee_paise?: number | null
          platform_share_paise?: number | null
          proof_url?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          reference_no?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversal_journal_entry_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          society_id: string
          society_share_paise?: number | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          user_id?: string | null
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string
          created_at?: string
          flat_id?: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          method?: string
          notes?: string | null
          paid_at?: string
          payment_date?: string | null
          platform_fee_paise?: number | null
          platform_share_paise?: number | null
          proof_url?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          reference_no?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversal_journal_entry_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          society_id?: string
          society_share_paise?: number | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          user_id?: string | null
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_entries: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          entry_date: string
          id: string
          kind: string
          paid_to: string | null
          purpose: string
          recorded_by: string | null
          request_id: string
          reverses: string | null
          society_id: string
          voucher_no: string | null
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          entry_date: string
          id?: string
          kind: string
          paid_to?: string | null
          purpose: string
          recorded_by?: string | null
          request_id: string
          reverses?: string | null
          society_id: string
          voucher_no?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          entry_date?: string
          id?: string
          kind?: string
          paid_to?: string | null
          purpose?: string
          recorded_by?: string | null
          request_id?: string
          reverses?: string | null
          society_id?: string
          voucher_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_entries_reverses_fkey"
            columns: ["reverses"]
            isOneToOne: false
            referencedRelation: "petty_cash_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_entries_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verifications: {
        Row: {
          created_at: string
          firebase_uid: string | null
          phone: string
          updated_at: string
          user_id: string
          verified_at: string
        }
        Insert: {
          created_at?: string
          firebase_uid?: string | null
          phone: string
          updated_at?: string
          user_id: string
          verified_at?: string
        }
        Update: {
          created_at?: string
          firebase_uid?: string | null
          phone?: string
          updated_at?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          ads_enabled: boolean
          created_at: string
          features: Json
          id: string
          is_recommended: boolean
          name: string
          price_monthly_inr: number
          price_per_flat_inr: number
          sort_order: number
          trial_days: number
          txn_fee_pct: number
        }
        Insert: {
          ads_enabled?: boolean
          created_at?: string
          features?: Json
          id: string
          is_recommended?: boolean
          name: string
          price_monthly_inr: number
          price_per_flat_inr?: number
          sort_order?: number
          trial_days?: number
          txn_fee_pct: number
        }
        Update: {
          ads_enabled?: boolean
          created_at?: string
          features?: Json
          id?: string
          is_recommended?: boolean
          name?: string
          price_monthly_inr?: number
          price_per_flat_inr?: number
          sort_order?: number
          trial_days?: number
          txn_fee_pct?: number
        }
        Relationships: []
      }
      platform_cost_entries: {
        Row: {
          amount_inr: number
          category: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          period_month: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_inr: number
          category: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          period_month: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_inr?: number
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          period_month?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          ads_banner_enabled: boolean
          ads_banner_placements: string[]
          ads_interstitial_enabled: boolean
          ads_interstitial_seconds: number
          ai_cost_per_request_inr: number | null
          id: number
          maintenance_fee_percent: number
          razorpay_configured: boolean
          razorpay_key_id: string | null
          updated_at: string
        }
        Insert: {
          ads_banner_enabled?: boolean
          ads_banner_placements?: string[]
          ads_interstitial_enabled?: boolean
          ads_interstitial_seconds?: number
          ai_cost_per_request_inr?: number | null
          id?: number
          maintenance_fee_percent?: number
          razorpay_configured?: boolean
          razorpay_key_id?: string | null
          updated_at?: string
        }
        Update: {
          ads_banner_enabled?: boolean
          ads_banner_placements?: string[]
          ads_interstitial_enabled?: boolean
          ads_interstitial_seconds?: number
          ai_cost_per_request_inr?: number | null
          id?: number
          maintenance_fee_percent?: number
          razorpay_configured?: boolean
          razorpay_key_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      poll_options: {
        Row: {
          id: string
          label: string
          poll_id: string
          position: number
        }
        Insert: {
          id?: string
          label: string
          poll_id: string
          position?: number
        }
        Update: {
          id?: string
          label?: string
          poll_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          flat_id: string | null
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          flat_id?: string | null
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          flat_id?: string | null
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          closed_at: string | null
          closes_at: string | null
          created_at: string
          created_by: string
          description: string | null
          eligibility: string | null
          frozen_at: string | null
          id: string
          kind: string
          secret_ballot: boolean
          society_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          eligibility?: string | null
          frozen_at?: string | null
          id?: string
          kind?: string
          secret_ballot?: boolean
          society_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          eligibility?: string | null
          frozen_at?: string | null
          id?: string
          kind?: string
          secret_ballot?: boolean
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          id: string
          kind: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          image_url: string | null
          society_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          image_url?: string | null
          society_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          society_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pricing_settings: {
        Row: {
          active_gateway: string
          custom_module_prices: Json
          enterprise_contact_email: string | null
          enterprise_contact_phone: string | null
          enterprise_threshold_units: number
          id: number
          promo_config: Json
          taxes: Json
          trial_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_gateway?: string
          custom_module_prices?: Json
          enterprise_contact_email?: string | null
          enterprise_contact_phone?: string | null
          enterprise_threshold_units?: number
          id?: number
          promo_config?: Json
          taxes?: Json
          trial_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_gateway?: string
          custom_module_prices?: Json
          enterprise_contact_email?: string | null
          enterprise_contact_phone?: string | null
          enterprise_threshold_units?: number
          id?: number
          promo_config?: Json
          taxes?: Json
          trial_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          created_at: string
          details: string
          id: string
          kind: string
          outcome: string | null
          retained: Json
          reviewed_at: string | null
          reviewed_by: string | null
          society_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: string
          id?: string
          kind: string
          outcome?: string | null
          retained?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: string
          id?: string
          kind?: string
          outcome?: string | null
          retained?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          kind: string
          mime: string
          path: string
          quotation_id: string | null
          remove_reason: string | null
          removed_at: string | null
          removed_by: string | null
          request_id: string
          size_bytes: number
          society_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          kind: string
          mime: string
          path: string
          quotation_id?: string | null
          remove_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          request_id: string
          size_bytes: number
          society_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          kind?: string
          mime?: string
          path?: string
          quotation_id?: string | null
          remove_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          request_id?: string
          size_bytes?: number
          society_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_attachments_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "procurement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_attachments_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_events: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          request_id: string
          society_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          request_id: string
          society_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          request_id?: string
          society_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "procurement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_events_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_quotations: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          notes: string | null
          quote_ref: string | null
          request_id: string
          society_id: string
          valid_until: string | null
          vendor_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          quote_ref?: string | null
          request_id: string
          society_id: string
          valid_until?: string | null
          vendor_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          quote_ref?: string | null
          request_id?: string
          society_id?: string
          valid_until?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_quotations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "procurement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotations_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_requests: {
        Row: {
          approved_amount: number | null
          cancel_reason: string | null
          category: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          description: string | null
          estimated_amount: number | null
          expense_id: string | null
          fy_start: number
          id: string
          invoice_amount: number | null
          invoice_date: string | null
          invoice_ref: string | null
          needed_by: string | null
          order_ref: string | null
          ordered_at: string | null
          payment_ref: string | null
          request_no: number
          requested_by: string
          selected_quotation_id: string | null
          society_id: string
          status: string
          title: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          approved_amount?: number | null
          cancel_reason?: string | null
          category: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          description?: string | null
          estimated_amount?: number | null
          expense_id?: string | null
          fy_start: number
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_ref?: string | null
          needed_by?: string | null
          order_ref?: string | null
          ordered_at?: string | null
          payment_ref?: string | null
          request_no?: never
          requested_by: string
          selected_quotation_id?: string | null
          society_id: string
          status?: string
          title: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          approved_amount?: number | null
          cancel_reason?: string | null
          category?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          description?: string | null
          estimated_amount?: number | null
          expense_id?: string | null
          fy_start?: number
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_ref?: string | null
          needed_by?: string | null
          order_ref?: string | null
          ordered_at?: string | null
          payment_ref?: string | null
          request_no?: never
          requested_by?: string
          selected_quotation_id?: string | null
          society_id?: string
          status?: string
          title?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_requests_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          aadhaar_last4: string | null
          aadhaar_rejected_at: string | null
          aadhaar_rejected_reason: string | null
          aadhaar_uploaded_at: string | null
          aadhaar_url: string | null
          aadhaar_verified: boolean
          aadhaar_verified_at: string | null
          aadhaar_verified_by: string | null
          accepted_terms_at: string | null
          active_flat_id: string | null
          avatar_url: string | null
          created_at: string
          elder_mode: boolean
          email: string | null
          full_name: string | null
          id: string
          is_offline: boolean
          move_in_date: string | null
          phone: string | null
          property_number: string | null
          referral_code: string | null
          referred_by: string | null
          share_certificate_number: string | null
          society_id: string | null
          theme: string
          ugvcl_number: string | null
          updated_at: string
        }
        Insert: {
          aadhaar_last4?: string | null
          aadhaar_rejected_at?: string | null
          aadhaar_rejected_reason?: string | null
          aadhaar_uploaded_at?: string | null
          aadhaar_url?: string | null
          aadhaar_verified?: boolean
          aadhaar_verified_at?: string | null
          aadhaar_verified_by?: string | null
          accepted_terms_at?: string | null
          active_flat_id?: string | null
          avatar_url?: string | null
          created_at?: string
          elder_mode?: boolean
          email?: string | null
          full_name?: string | null
          id: string
          is_offline?: boolean
          move_in_date?: string | null
          phone?: string | null
          property_number?: string | null
          referral_code?: string | null
          referred_by?: string | null
          share_certificate_number?: string | null
          society_id?: string | null
          theme?: string
          ugvcl_number?: string | null
          updated_at?: string
        }
        Update: {
          aadhaar_last4?: string | null
          aadhaar_rejected_at?: string | null
          aadhaar_rejected_reason?: string | null
          aadhaar_uploaded_at?: string | null
          aadhaar_url?: string | null
          aadhaar_verified?: boolean
          aadhaar_verified_at?: string | null
          aadhaar_verified_by?: string | null
          accepted_terms_at?: string | null
          active_flat_id?: string | null
          avatar_url?: string | null
          created_at?: string
          elder_mode?: boolean
          email?: string | null
          full_name?: string | null
          id?: string
          is_offline?: boolean
          move_in_date?: string | null
          phone?: string | null
          property_number?: string | null
          referral_code?: string | null
          referred_by?: string | null
          share_certificate_number?: string | null
          society_id?: string | null
          theme?: string
          ugvcl_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_flat_id_fkey"
            columns: ["active_flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      referral_earnings: {
        Row: {
          amount: number
          created_at: string
          id: string
          note: string | null
          rate: number
          referred_user_id: string
          referrer_id: string
          society_id: string | null
          status: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          rate?: number
          referred_user_id: string
          referrer_id: string
          society_id?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          rate?: number
          referred_user_id?: string
          referrer_id?: string
          society_id?: string | null
          status?: string
        }
        Relationships: []
      }
      resident_subscriptions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          plan_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          plan_id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          plan_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rfid_credentials: {
        Row: {
          created_at: string
          created_by: string | null
          credential_hash: string
          flat_id: string | null
          id: string
          label: string | null
          last4: string
          revoked_at: string | null
          revoked_by: string | null
          society_id: string
          status: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credential_hash: string
          flat_id?: string | null
          id?: string
          label?: string | null
          last4: string
          revoked_at?: string | null
          revoked_by?: string | null
          society_id: string
          status?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credential_hash?: string
          flat_id?: string | null
          id?: string
          label?: string | null
          last4?: string
          revoked_at?: string | null
          revoked_by?: string | null
          society_id?: string
          status?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rfid_credentials_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfid_credentials_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfid_credentials_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cancelled_reason: string | null
          created_at: string
          display_name: string | null
          expires_at: string
          id: string
          invited_by: string
          permissions: string[]
          phone_digits: string
          role: Database["public"]["Enums"]["app_role"]
          society_id: string
          staff_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          display_name?: string | null
          expires_at?: string
          id?: string
          invited_by: string
          permissions?: string[]
          phone_digits: string
          role: Database["public"]["Enums"]["app_role"]
          society_id: string
          staff_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          display_name?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          permissions?: string[]
          phone_digits?: string
          role?: Database["public"]["Enums"]["app_role"]
          society_id?: string
          staff_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_invitations_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_invitations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "society_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      role_sessions: {
        Row: {
          device: string | null
          last_seen_at: string
          role_id: string
          society_id: string
          user_id: string
        }
        Insert: {
          device?: string | null
          last_seen_at?: string
          role_id: string
          society_id: string
          user_id: string
        }
        Update: {
          device?: string | null
          last_seen_at?: string
          role_id?: string
          society_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_sessions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: true
            referencedRelation: "user_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_payment_events: {
        Row: {
          attempt_count: number
          event_type: string
          failure_code: string | null
          id: string
          payload_sha256: string
          payment_id: string | null
          processed_at: string | null
          processing_status: string
          provider: string
          provider_event_id: string
          received_at: string
          signature_verified: boolean
          society_id: string | null
        }
        Insert: {
          attempt_count?: number
          event_type: string
          failure_code?: string | null
          id?: string
          payload_sha256: string
          payment_id?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id: string
          received_at?: string
          signature_verified?: boolean
          society_id?: string | null
        }
        Update: {
          attempt_count?: number
          event_type?: string
          failure_code?: string | null
          id?: string
          payload_sha256?: string
          payment_id?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_verified?: boolean
          society_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "saas_subscription_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_payment_events_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_subscription_order_requests: {
        Row: {
          amount_paise: number
          attempt_count: number
          created_at: string
          currency: string
          failure_code: string | null
          flat_count: number | null
          id: string
          plan_id: string
          price_per_flat_inr: number | null
          provider_mode: string
          razorpay_order_id: string | null
          request_id: string
          requested_by: string
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          attempt_count?: number
          created_at?: string
          currency?: string
          failure_code?: string | null
          flat_count?: number | null
          id?: string
          plan_id: string
          price_per_flat_inr?: number | null
          provider_mode: string
          razorpay_order_id?: string | null
          request_id: string
          requested_by: string
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          attempt_count?: number
          created_at?: string
          currency?: string
          failure_code?: string | null
          flat_count?: number | null
          id?: string
          plan_id?: string
          price_per_flat_inr?: number | null
          provider_mode?: string
          razorpay_order_id?: string | null
          request_id?: string
          requested_by?: string
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscription_order_requests_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_subscription_order_requests_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_subscription_payments: {
        Row: {
          amount_paise: number
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency: string
          failed_at: string | null
          failure_code: string | null
          flat_count: number | null
          id: string
          lifecycle_status: string
          plan_id: string
          price_per_flat_inr: number | null
          provider_mode: string | null
          provider_status: string | null
          purchased_by: string
          razorpay_order_id: string
          razorpay_payment_id: string | null
          refund_reference: string | null
          refunded_at: string | null
          request_id: string | null
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_code?: string | null
          flat_count?: number | null
          id?: string
          lifecycle_status?: string
          plan_id: string
          price_per_flat_inr?: number | null
          provider_mode?: string | null
          provider_status?: string | null
          purchased_by: string
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          refund_reference?: string | null
          refunded_at?: string | null
          request_id?: string | null
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_code?: string | null
          flat_count?: number | null
          id?: string
          lifecycle_status?: string
          plan_id?: string
          price_per_flat_inr?: number | null
          provider_mode?: string | null
          provider_status?: string | null
          purchased_by?: string
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          refund_reference?: string | null
          refunded_at?: string | null
          request_id?: string | null
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscription_payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_subscription_payments_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_subscription_receipt_sequences: {
        Row: {
          last_number: number
          period_yyyymm: number
          updated_at: string
        }
        Insert: {
          last_number?: number
          period_yyyymm: number
          updated_at?: string
        }
        Update: {
          last_number?: number
          period_yyyymm?: number
          updated_at?: string
        }
        Relationships: []
      }
      saas_subscription_receipts: {
        Row: {
          amount_paise: number
          currency: string
          id: string
          issued_at: string
          payment_id: string
          plan_id: string
          purchased_by: string
          receipt_number: string
          refunded_at: string | null
          society_id: string
          status: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount_paise: number
          currency?: string
          id?: string
          issued_at?: string
          payment_id: string
          plan_id: string
          purchased_by: string
          receipt_number: string
          refunded_at?: string | null
          society_id: string
          status?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_paise?: number
          currency?: string
          id?: string
          issued_at?: string
          payment_id?: string
          plan_id?: string
          purchased_by?: string
          receipt_number?: string
          refunded_at?: string | null
          society_id?: string
          status?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscription_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "saas_subscription_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_subscription_receipts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_subscription_receipts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_subscription_refunds: {
        Row: {
          amount_paise: number
          currency: string
          failure_code: string | null
          id: string
          payment_id: string
          processed_at: string | null
          provider_refund_id: string | null
          reason: string
          request_id: string
          requested_at: string
          requested_by: string
          society_id: string
          status: string
        }
        Insert: {
          amount_paise: number
          currency?: string
          failure_code?: string | null
          id?: string
          payment_id: string
          processed_at?: string | null
          provider_refund_id?: string | null
          reason: string
          request_id: string
          requested_at?: string
          requested_by: string
          society_id: string
          status?: string
        }
        Update: {
          amount_paise?: number
          currency?: string
          failure_code?: string | null
          id?: string
          payment_id?: string
          processed_at?: string | null
          provider_refund_id?: string | null
          reason?: string
          request_id?: string
          requested_at?: string
          requested_by?: string
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscription_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "saas_subscription_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_subscription_refunds_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          escalated_at: string | null
          flat_id: string
          id: string
          kind: string
          last_seen: string | null
          note: string | null
          raised_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          society_id: string
          status: string
          subject_name: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          escalated_at?: string | null
          flat_id: string
          id?: string
          kind: string
          last_seen?: string | null
          note?: string | null
          raised_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          society_id: string
          status?: string
          subject_name?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          escalated_at?: string | null
          flat_id?: string
          id?: string
          kind?: string
          last_seen?: string | null
          note?: string | null
          raised_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          society_id?: string
          status?: string
          subject_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_alerts_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_alerts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          flat_id: string
          id: string
          is_active: boolean
          name: string
          phone: string
          relation: string | null
          society_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          flat_id: string
          id?: string
          is_active?: boolean
          name: string
          phone: string
          relation?: string | null
          society_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          flat_id?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string
          relation?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_contacts_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_contacts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_job_runs: {
        Row: {
          attempts: number
          error: string | null
          failed: number
          finished_at: string | null
          id: string
          job: string
          last_skipped_at: string | null
          processed: number
          recovered_count: number
          run_key: string
          skip_count: number
          started_at: string
          status: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          job: string
          last_skipped_at?: string | null
          processed?: number
          recovered_count?: number
          run_key: string
          skip_count?: number
          started_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          job?: string
          last_skipped_at?: string | null
          processed?: number
          recovered_count?: number
          run_key?: string
          skip_count?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      security_incidents: {
        Row: {
          created_at: string
          id: string
          kind: string
          note: string
          patrol_round_id: string | null
          reported_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          society_id: string
          status: string
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          note: string
          patrol_round_id?: string | null
          reported_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          society_id: string
          status?: string
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          note?: string
          patrol_round_id?: string | null
          reported_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          society_id?: string
          status?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_incidents_patrol_round_id_fkey"
            columns: ["patrol_round_id"]
            isOneToOne: false
            referencedRelation: "patrol_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_incidents_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_incidents_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          active: boolean
          created_at: string
          icon: string
          id: string
          label: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          icon?: string
          id?: string
          label: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          icon?: string
          id?: string
          label?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      smart_qr_codes: {
        Row: {
          accepts_cash: boolean
          account_number: string
          bank_name: string | null
          category_id: string
          created_at: string
          created_by: string
          expires_at: string | null
          fixed_amount: number | null
          id: string
          ifsc: string
          instructions: string | null
          is_active: boolean
          payee_name: string
          purpose: string | null
          society_id: string
          title: string
          token: string
          updated_at: string
        }
        Insert: {
          accepts_cash?: boolean
          account_number: string
          bank_name?: string | null
          category_id: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          fixed_amount?: number | null
          id?: string
          ifsc: string
          instructions?: string | null
          is_active?: boolean
          payee_name: string
          purpose?: string | null
          society_id: string
          title: string
          token: string
          updated_at?: string
        }
        Update: {
          accepts_cash?: boolean
          account_number?: string
          bank_name?: string | null
          category_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          fixed_amount?: number | null
          id?: string
          ifsc?: string
          instructions?: string | null
          is_active?: boolean
          payee_name?: string
          purpose?: string | null
          society_id?: string
          title?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_qr_codes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "society_income_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_qr_codes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_qr_submissions: {
        Row: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          income_record_id: string | null
          note: string | null
          paid_on: string
          payer_name: string
          payer_phone: string | null
          payment_method: string
          qr_id: string
          reference_number: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          society_id: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          idempotency_key: string
          income_record_id?: string | null
          note?: string | null
          paid_on: string
          payer_name: string
          payer_phone?: string | null
          payment_method: string
          qr_id: string
          reference_number?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          income_record_id?: string | null
          note?: string | null
          paid_on?: string
          payer_name?: string
          payer_phone?: string | null
          payment_method?: string
          qr_id?: string
          reference_number?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_qr_submissions_income_record_id_fkey"
            columns: ["income_record_id"]
            isOneToOne: false
            referencedRelation: "society_income_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_qr_submissions_qr_id_fkey"
            columns: ["qr_id"]
            isOneToOne: false
            referencedRelation: "smart_qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_qr_submissions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      societies: {
        Row: {
          address: string | null
          bill_theme: string
          billing_active: boolean
          business_address: string | null
          business_city: string | null
          business_gstin: string | null
          business_pan: string | null
          business_pincode: string | null
          business_state: string | null
          city: string | null
          created_at: string
          full_address: string | null
          id: string
          invite_code: string | null
          invite_code_enabled: boolean
          layout: Database["public"]["Enums"]["society_layout"]
          legal_business_name: string | null
          logo_url: string | null
          name: string
          payout_bank_last4: string | null
          payout_holder_name: string | null
          payout_status: string
          pincode: string | null
          plan: string
          plan_expires_at: string | null
          plan_id: string | null
          plan_selected_at: string | null
          plan_status: string
          property_type: string
          razorpay_account_id: string | null
          registration_no: string | null
          registration_number: string | null
          signature_url: string | null
          state: string | null
          status: string
          structure_label: string
          structure_mode: string | null
          total_units: number | null
          trial_consumed_at: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bill_theme?: string
          billing_active?: boolean
          business_address?: string | null
          business_city?: string | null
          business_gstin?: string | null
          business_pan?: string | null
          business_pincode?: string | null
          business_state?: string | null
          city?: string | null
          created_at?: string
          full_address?: string | null
          id?: string
          invite_code?: string | null
          invite_code_enabled?: boolean
          layout?: Database["public"]["Enums"]["society_layout"]
          legal_business_name?: string | null
          logo_url?: string | null
          name: string
          payout_bank_last4?: string | null
          payout_holder_name?: string | null
          payout_status?: string
          pincode?: string | null
          plan?: string
          plan_expires_at?: string | null
          plan_id?: string | null
          plan_selected_at?: string | null
          plan_status?: string
          property_type?: string
          razorpay_account_id?: string | null
          registration_no?: string | null
          registration_number?: string | null
          signature_url?: string | null
          state?: string | null
          status?: string
          structure_label?: string
          structure_mode?: string | null
          total_units?: number | null
          trial_consumed_at?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bill_theme?: string
          billing_active?: boolean
          business_address?: string | null
          business_city?: string | null
          business_gstin?: string | null
          business_pan?: string | null
          business_pincode?: string | null
          business_state?: string | null
          city?: string | null
          created_at?: string
          full_address?: string | null
          id?: string
          invite_code?: string | null
          invite_code_enabled?: boolean
          layout?: Database["public"]["Enums"]["society_layout"]
          legal_business_name?: string | null
          logo_url?: string | null
          name?: string
          payout_bank_last4?: string | null
          payout_holder_name?: string | null
          payout_status?: string
          pincode?: string | null
          plan?: string
          plan_expires_at?: string | null
          plan_id?: string | null
          plan_selected_at?: string | null
          plan_status?: string
          property_type?: string
          razorpay_account_id?: string | null
          registration_no?: string | null
          registration_number?: string | null
          signature_url?: string | null
          state?: string | null
          status?: string
          structure_label?: string
          structure_mode?: string | null
          total_units?: number | null
          trial_consumed_at?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "societies_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      society_assets: {
        Row: {
          amc_until: string | null
          category: string
          created_at: string
          created_by: string | null
          id: string
          installed_on: string | null
          location: string | null
          name: string
          notes: string | null
          purchase_date: string | null
          qr_token: string
          society_id: string
          status: string
          updated_at: string
          vendor_id: string | null
          warranty_until: string | null
        }
        Insert: {
          amc_until?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          installed_on?: string | null
          location?: string | null
          name: string
          notes?: string | null
          purchase_date?: string | null
          qr_token?: string
          society_id: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
          warranty_until?: string | null
        }
        Update: {
          amc_until?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          installed_on?: string | null
          location?: string | null
          name?: string
          notes?: string | null
          purchase_date?: string | null
          qr_token?: string
          society_id?: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
          warranty_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_assets_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_assets_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      society_automation_settings: {
        Row: {
          created_at: string
          reminder_min_days_overdue: number
          reminder_repeat_days: number
          reminders_enabled: boolean
          society_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          reminder_min_days_overdue?: number
          reminder_repeat_days?: number
          reminders_enabled?: boolean
          society_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          reminder_min_days_overdue?: number
          reminder_repeat_days?: number
          reminders_enabled?: boolean
          society_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_automation_settings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_branding: {
        Row: {
          accent_color: string | null
          display_name: string | null
          logo_path: string | null
          primary_color: string | null
          society_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accent_color?: string | null
          display_name?: string | null
          logo_path?: string | null
          primary_color?: string | null
          society_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accent_color?: string | null
          display_name?: string | null
          logo_path?: string | null
          primary_color?: string | null
          society_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_branding_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_budget_revisions: {
        Row: {
          actor_id: string
          budget_id: string
          created_at: string
          id: string
          new_amount: number
          old_amount: number | null
          reason: string | null
          society_id: string
        }
        Insert: {
          actor_id: string
          budget_id: string
          created_at?: string
          id?: string
          new_amount: number
          old_amount?: number | null
          reason?: string | null
          society_id: string
        }
        Update: {
          actor_id?: string
          budget_id?: string
          created_at?: string
          id?: string
          new_amount?: number
          old_amount?: number | null
          reason?: string | null
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "society_budget_revisions_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "society_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_budget_revisions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_budgets: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string
          fy_start: number
          id: string
          notes: string | null
          society_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by: string
          fy_start: number
          id?: string
          notes?: string | null
          society_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string
          fy_start?: number
          id?: string
          notes?: string | null
          society_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_budgets_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_contacts: {
        Row: {
          category: string
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          role_label: string
          society_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          role_label: string
          society_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          role_label?: string
          society_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "society_contacts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_document_versions: {
        Row: {
          file_name: string | null
          id: string
          mime_type: string | null
          size_bytes: number | null
          society_id: string
          source_id: string
          storage_path: string
          superseded_at: string
          superseded_by: string
          version: number
        }
        Insert: {
          file_name?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          society_id: string
          source_id: string
          storage_path: string
          superseded_at?: string
          superseded_by: string
          version: number
        }
        Update: {
          file_name?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          society_id?: string
          source_id?: string
          storage_path?: string
          superseded_at?: string
          superseded_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "society_document_versions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "society_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      society_income_categories: {
        Row: {
          category_group: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          society_id: string
          updated_at: string
        }
        Insert: {
          category_group?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          society_id: string
          updated_at?: string
        }
        Update: {
          category_group?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "society_income_categories_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_income_records: {
        Row: {
          amount: number
          category_confirmed_at: string | null
          category_confirmed_by: string | null
          category_decision_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          creation_payload_hash: string | null
          creation_request_id: string | null
          description: string | null
          id: string
          journal_entry_id: string | null
          non_member_payer_id: string | null
          payer_kind: string
          payment_date: string
          payment_method: string
          payment_status: string
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_reason: string | null
          reconciliation_reference: string | null
          reconciliation_status: string
          reference_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          resident_user_id: string | null
          reversal_journal_entry_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          society_id: string
          source: string
          suggested_at: string | null
          suggested_category_id: string | null
          suggestion_confidence: string | null
          suggestion_explanation: string | null
          suggestion_revision: string | null
          updated_at: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          category_confirmed_at?: string | null
          category_confirmed_by?: string | null
          category_decision_id?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          creation_payload_hash?: string | null
          creation_request_id?: string | null
          description?: string | null
          id?: string
          journal_entry_id?: string | null
          non_member_payer_id?: string | null
          payer_kind: string
          payment_date?: string
          payment_method: string
          payment_status?: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_reason?: string | null
          reconciliation_reference?: string | null
          reconciliation_status?: string
          reference_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          resident_user_id?: string | null
          reversal_journal_entry_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          society_id: string
          source?: string
          suggested_at?: string | null
          suggested_category_id?: string | null
          suggestion_confidence?: string | null
          suggestion_explanation?: string | null
          suggestion_revision?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          category_confirmed_at?: string | null
          category_confirmed_by?: string | null
          category_decision_id?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          creation_payload_hash?: string | null
          creation_request_id?: string | null
          description?: string | null
          id?: string
          journal_entry_id?: string | null
          non_member_payer_id?: string | null
          payer_kind?: string
          payment_date?: string
          payment_method?: string
          payment_status?: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_reason?: string | null
          reconciliation_reference?: string | null
          reconciliation_status?: string
          reference_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          resident_user_id?: string | null
          reversal_journal_entry_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          society_id?: string
          source?: string
          suggested_at?: string | null
          suggested_category_id?: string | null
          suggestion_confidence?: string | null
          suggestion_explanation?: string | null
          suggestion_revision?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_income_records_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "society_income_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_income_records_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_income_records_non_member_payer_id_fkey"
            columns: ["non_member_payer_id"]
            isOneToOne: false
            referencedRelation: "non_member_payers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_income_records_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_income_records_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_knowledge_sources: {
        Row: {
          archived_at: string | null
          audience: string
          category: string
          created_at: string
          created_by: string | null
          expires_on: string | null
          extracted_text: string | null
          faq_answer: string | null
          file_name: string | null
          flat_resident_id: string | null
          id: string
          kind: string
          mime_type: string | null
          reminder_audience: string
          reminder_days: number[]
          size_bytes: number | null
          society_id: string
          status: string
          status_reason: string | null
          storage_path: string | null
          text_chars: number
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          archived_at?: string | null
          audience?: string
          category?: string
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          extracted_text?: string | null
          faq_answer?: string | null
          file_name?: string | null
          flat_resident_id?: string | null
          id?: string
          kind: string
          mime_type?: string | null
          reminder_audience?: string
          reminder_days?: number[]
          size_bytes?: number | null
          society_id: string
          status?: string
          status_reason?: string | null
          storage_path?: string | null
          text_chars?: number
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          archived_at?: string | null
          audience?: string
          category?: string
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          extracted_text?: string | null
          faq_answer?: string | null
          file_name?: string | null
          flat_resident_id?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          reminder_audience?: string
          reminder_days?: number[]
          size_bytes?: number | null
          society_id?: string
          status?: string
          status_reason?: string | null
          storage_path?: string | null
          text_chars?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "society_knowledge_sources_flat_resident_id_fkey"
            columns: ["flat_resident_id"]
            isOneToOne: false
            referencedRelation: "flat_residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "society_knowledge_sources_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_settings: {
        Row: {
          address: string | null
          bill_run_approval_required: boolean
          bylaws_html: string | null
          bylaws_pdf_path: string | null
          city: string | null
          created_at: string
          default_bill_template_id: string | null
          dynamic_profile_fields: Json
          financial_year_label: string | null
          financial_year_start_month: number
          grace_days: number
          handover_note: string | null
          handover_status: string
          handover_updated_at: string | null
          handover_updated_by: string | null
          late_fee_amount: number
          late_fee_enabled: boolean
          late_fee_type: string
          maintenance_due_day: number
          maintenance_frequency: string
          opening_balance_date: string | null
          opening_bank: number
          opening_cash: number
          pincode: string | null
          privacy_contacts: string
          privacy_directory: string
          privacy_documents: string
          privacy_finances: string
          privacy_vehicles: string
          registration_no: string | null
          setup_completed_at: string | null
          society_id: string
          state: string | null
          structure_type: string
          tenancy_warning_days: number
          updated_at: string
          wizard_state: Json
          wizard_step: number
          wizard_version: number
        }
        Insert: {
          address?: string | null
          bill_run_approval_required?: boolean
          bylaws_html?: string | null
          bylaws_pdf_path?: string | null
          city?: string | null
          created_at?: string
          default_bill_template_id?: string | null
          dynamic_profile_fields?: Json
          financial_year_label?: string | null
          financial_year_start_month?: number
          grace_days?: number
          handover_note?: string | null
          handover_status?: string
          handover_updated_at?: string | null
          handover_updated_by?: string | null
          late_fee_amount?: number
          late_fee_enabled?: boolean
          late_fee_type?: string
          maintenance_due_day?: number
          maintenance_frequency?: string
          opening_balance_date?: string | null
          opening_bank?: number
          opening_cash?: number
          pincode?: string | null
          privacy_contacts?: string
          privacy_directory?: string
          privacy_documents?: string
          privacy_finances?: string
          privacy_vehicles?: string
          registration_no?: string | null
          setup_completed_at?: string | null
          society_id: string
          state?: string | null
          structure_type?: string
          tenancy_warning_days?: number
          updated_at?: string
          wizard_state?: Json
          wizard_step?: number
          wizard_version?: number
        }
        Update: {
          address?: string | null
          bill_run_approval_required?: boolean
          bylaws_html?: string | null
          bylaws_pdf_path?: string | null
          city?: string | null
          created_at?: string
          default_bill_template_id?: string | null
          dynamic_profile_fields?: Json
          financial_year_label?: string | null
          financial_year_start_month?: number
          grace_days?: number
          handover_note?: string | null
          handover_status?: string
          handover_updated_at?: string | null
          handover_updated_by?: string | null
          late_fee_amount?: number
          late_fee_enabled?: boolean
          late_fee_type?: string
          maintenance_due_day?: number
          maintenance_frequency?: string
          opening_balance_date?: string | null
          opening_bank?: number
          opening_cash?: number
          pincode?: string | null
          privacy_contacts?: string
          privacy_directory?: string
          privacy_documents?: string
          privacy_finances?: string
          privacy_vehicles?: string
          registration_no?: string | null
          setup_completed_at?: string | null
          society_id?: string
          state?: string | null
          structure_type?: string
          tenancy_warning_days?: number
          updated_at?: string
          wizard_state?: Json
          wizard_step?: number
          wizard_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "society_settings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_staff: {
        Row: {
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          is_active: boolean
          job_type: string
          notes: string | null
          phone: string | null
          shift_days: number[]
          shift_end: string | null
          shift_start: string | null
          society_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          job_type: string
          notes?: string | null
          phone?: string | null
          shift_days?: number[]
          shift_end?: string | null
          shift_start?: string | null
          society_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          job_type?: string
          notes?: string | null
          phone?: string | null
          shift_days?: number[]
          shift_end?: string | null
          shift_start?: string | null
          society_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_staff_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_tax_settings: {
        Row: {
          gst_registered: boolean
          gst_state_code: string | null
          society_id: string
          tan: string | null
          tds_deductor: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          gst_registered?: boolean
          gst_state_code?: string | null
          society_id: string
          tan?: string | null
          tds_deductor?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          gst_registered?: boolean
          gst_state_code?: string | null
          society_id?: string
          tan?: string | null
          tds_deductor?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "society_tax_settings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      society_upi_settings: {
        Row: {
          enabled: boolean
          payee_name: string
          qr_path: string | null
          society_id: string
          updated_at: string
          updated_by: string | null
          upi_vpa: string
        }
        Insert: {
          enabled?: boolean
          payee_name: string
          qr_path?: string | null
          society_id: string
          updated_at?: string
          updated_by?: string | null
          upi_vpa: string
        }
        Update: {
          enabled?: boolean
          payee_name?: string
          qr_path?: string | null
          society_id?: string
          updated_at?: string
          updated_by?: string | null
          upi_vpa?: string
        }
        Relationships: [
          {
            foreignKeyName: "society_upi_settings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: true
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          flat_id: string | null
          id: string
          note: string | null
          raised_by: string
          resolved_at: string | null
          resolved_by: string | null
          society_id: string
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          flat_id?: string | null
          id?: string
          note?: string | null
          raised_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          society_id: string
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          flat_id?: string | null
          id?: string
          note?: string | null
          raised_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          society_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_alerts_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          created_at: string
          day: string
          id: string
          note: string | null
          recorded_by: string | null
          society_id: string
          staff_id: string
          status: string
        }
        Insert: {
          created_at?: string
          day: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          society_id: string
          staff_id: string
          status: string
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          society_id?: string
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "society_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          body: string | null
          created_at: string
          from_status: string | null
          id: string
          kind: string
          society_id: string
          ticket_id: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_kind: string
          body?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          kind: string
          society_id: string
          ticket_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          body?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          kind?: string
          society_id?: string
          ticket_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          ai_transcript: Json | null
          approval_status: string | null
          asset_id: string | null
          assigned_to: string | null
          category: string
          closed_at: string | null
          created_at: string
          description: string
          escalation_level: number
          escalation_reason: string | null
          hold_reason: string | null
          id: string
          last_activity_at: string
          parent_ticket_id: string | null
          priority: string
          reopened_count: number
          requires_approval: boolean
          resolution_note: string | null
          resolved_at: string | null
          sla_due_at: string | null
          society_id: string | null
          staff_id: string | null
          status: string
          subject: string
          ticket_no: number
          updated_at: string
          user_id: string
          vendor_id: string | null
        }
        Insert: {
          ai_transcript?: Json | null
          approval_status?: string | null
          asset_id?: string | null
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          description: string
          escalation_level?: number
          escalation_reason?: string | null
          hold_reason?: string | null
          id?: string
          last_activity_at?: string
          parent_ticket_id?: string | null
          priority?: string
          reopened_count?: number
          requires_approval?: boolean
          resolution_note?: string | null
          resolved_at?: string | null
          sla_due_at?: string | null
          society_id?: string | null
          staff_id?: string | null
          status?: string
          subject: string
          ticket_no?: never
          updated_at?: string
          user_id: string
          vendor_id?: string | null
        }
        Update: {
          ai_transcript?: Json | null
          approval_status?: string | null
          asset_id?: string | null
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          description?: string
          escalation_level?: number
          escalation_reason?: string | null
          hold_reason?: string | null
          id?: string
          last_activity_at?: string
          parent_ticket_id?: string | null
          priority?: string
          reopened_count?: number
          requires_approval?: boolean
          resolution_note?: string | null
          resolved_at?: string | null
          sla_due_at?: string | null
          society_id?: string | null
          staff_id?: string | null
          status?: string
          subject?: string
          ticket_no?: never
          updated_at?: string
          user_id?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "society_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_parent_ticket_id_fkey"
            columns: ["parent_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "society_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_questions: {
        Row: {
          id: string
          options: Json
          poll_id: string
          position: number
          prompt: string
          qtype: string
          required: boolean
          society_id: string
        }
        Insert: {
          id?: string
          options?: Json
          poll_id: string
          position: number
          prompt: string
          qtype: string
          required?: boolean
          society_id: string
        }
        Update: {
          id?: string
          options?: Json
          poll_id?: string
          position?: number
          prompt?: string
          qtype?: string
          required?: boolean
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          answers: Json
          created_at: string
          id: string
          poll_id: string
          society_id: string
          user_id: string
        }
        Insert: {
          answers: Json
          created_at?: string
          id?: string
          poll_id: string
          society_id: string
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          poll_id?: string
          society_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      temporary_occupants: {
        Row: {
          created_at: string
          created_by: string
          ended_at: string | null
          flat_id: string
          full_name: string
          id: string
          phone: string | null
          relation: string
          society_id: string
          stay_from: string
          stay_until: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ended_at?: string | null
          flat_id: string
          full_name: string
          id?: string
          phone?: string | null
          relation: string
          society_id: string
          stay_from: string
          stay_until: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ended_at?: string | null
          flat_id?: string
          full_name?: string
          id?: string
          phone?: string | null
          relation?: string
          society_id?: string
          stay_from?: string
          stay_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "temporary_occupants_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_occupants_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      tenancy_reminders_sent: {
        Row: {
          flat_resident_id: string
          id: string
          sent_at: string
          window_key: string
        }
        Insert: {
          flat_resident_id: string
          id?: string
          sent_at?: string
          window_key: string
        }
        Update: {
          flat_resident_id?: string
          id?: string
          sent_at?: string
          window_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenancy_reminders_sent_flat_resident_id_fkey"
            columns: ["flat_resident_id"]
            isOneToOne: false
            referencedRelation: "flat_residents"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          created_at: string
          id: string
          mime: string
          path: string
          size_bytes: number
          society_id: string
          ticket_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime: string
          path: string
          size_bytes: number
          society_id: string
          ticket_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          mime?: string
          path?: string
          size_bytes?: number
          society_id?: string
          ticket_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_ratings: {
        Row: {
          comment: string | null
          created_at: string
          rating: number
          society_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          rating: number
          society_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          rating?: number
          society_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_ratings_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_billing_overrides: {
        Row: {
          amount: number
          created_at: string
          flat_id: string
          id: string
          reason: string | null
          society_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          flat_id: string
          id?: string
          reason?: string | null
          society_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          flat_id?: string
          id?: string
          reason?: string | null
          society_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_billing_overrides_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: true
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_billing_overrides_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_last_active: {
        Row: {
          last_active_at: string
          user_id: string
        }
        Insert: {
          last_active_at?: string
          user_id: string
        }
        Update: {
          last_active_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          link: string | null
          priority: string
          read_at: string | null
          society_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind: string
          link?: string | null
          priority?: string
          read_at?: string | null
          society_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          link?: string | null
          priority?: string
          read_at?: string | null
          society_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      user_points: {
        Row: {
          created_at: string
          id: string
          points: number
          reason: string
          society_id: string
          source_ref: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          points: number
          reason: string
          society_id: string
          source_ref?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          points?: number
          reason?: string
          society_id?: string
          source_ref?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_role_block_scopes: {
        Row: {
          assigned_by: string | null
          block_id: string
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          id: string
          is_active: boolean
          role_id: string
          society_id: string
        }
        Insert: {
          assigned_by?: string | null
          block_id: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          role_id: string
          society_id: string
        }
        Update: {
          assigned_by?: string | null
          block_id?: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          role_id?: string
          society_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_block_scopes_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_block_scopes_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "user_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_block_scopes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_by: string | null
          block_id: string | null
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          id: string
          is_active: boolean
          permissions: string[]
          revoked_reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          society_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          block_id?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          permissions?: string[]
          revoked_reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          society_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          block_id?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          permissions?: string[]
          revoked_reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          society_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_meter_readings: {
        Row: {
          created_at: string
          id: string
          is_abnormal: boolean
          meter_id: string
          note: string | null
          reading: number
          reading_date: string
          recorded_by: string | null
          society_id: string
          units: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_abnormal?: boolean
          meter_id: string
          note?: string | null
          reading: number
          reading_date: string
          recorded_by?: string | null
          society_id: string
          units?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_abnormal?: boolean
          meter_id?: string
          note?: string | null
          reading?: number
          reading_date?: string
          recorded_by?: string | null
          society_id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "utility_meter_readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "utility_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_meter_readings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_meters: {
        Row: {
          created_at: string
          created_by: string | null
          flat_id: string | null
          id: string
          installed_on: string
          label: string | null
          meter_number: string
          replaced_by: string | null
          society_id: string
          status: string
          utility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          flat_id?: string | null
          id?: string
          installed_on?: string
          label?: string | null
          meter_number: string
          replaced_by?: string | null
          society_id: string
          status?: string
          utility: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          flat_id?: string | null
          id?: string
          installed_on?: string
          label?: string | null
          meter_number?: string
          replaced_by?: string | null
          society_id?: string
          status?: string
          utility?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_meters_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_meters_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "utility_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_meters_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          flat_id: string | null
          id: string
          is_active: boolean
          make_model: string | null
          offline_resident_id: string | null
          plate_number: string
          society_id: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          flat_id?: string | null
          id?: string
          is_active?: boolean
          make_model?: string | null
          offline_resident_id?: string | null
          plate_number: string
          society_id: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          flat_id?: string | null
          id?: string
          is_active?: boolean
          make_model?: string | null
          offline_resident_id?: string | null
          plate_number?: string
          society_id?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_offline_resident_id_fkey"
            columns: ["offline_resident_id"]
            isOneToOne: false
            referencedRelation: "offline_residents"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_reason: string | null
          rater_id: string
          rater_kind: string
          rating: number
          service_log_id: string | null
          society_id: string
          status: string
          ticket_id: string | null
          vendor_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          rater_id: string
          rater_kind: string
          rating: number
          service_log_id?: string | null
          society_id: string
          status?: string
          ticket_id?: string | null
          vendor_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          rater_id?: string
          rater_kind?: string
          rating?: number
          service_log_id?: string | null
          society_id?: string
          status?: string
          ticket_id?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_ratings_service_log_id_fkey"
            columns: ["service_log_id"]
            isOneToOne: true
            referencedRelation: "asset_service_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_ratings_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_ratings_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_ratings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_recurring_passes: {
        Row: {
          category: string
          created_at: string
          created_by: string
          days: number[]
          end_time: string
          flat_id: string
          id: string
          phone: string | null
          society_id: string
          start_time: string
          status: string
          updated_at: string
          valid_from: string
          valid_until: string
          visitor_name: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by: string
          days: number[]
          end_time: string
          flat_id: string
          id?: string
          phone?: string | null
          society_id: string
          start_time: string
          status?: string
          updated_at?: string
          valid_from?: string
          valid_until: string
          visitor_name: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          days?: number[]
          end_time?: string
          flat_id?: string
          id?: string
          phone?: string | null
          society_id?: string
          start_time?: string
          status?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitor_recurring_passes_flat_id_fkey"
            columns: ["flat_id"]
            isOneToOne: false
            referencedRelation: "flats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitor_recurring_passes_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_restrictions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          phone: string | null
          reason: string
          society_id: string
          updated_at: string
          visitor_name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          phone?: string | null
          reason: string
          society_id: string
          updated_at?: string
          visitor_name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          reason?: string
          society_id?: string
          updated_at?: string
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitor_restrictions_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      visitors: {
        Row: {
          approved_by: string | null
          category: string
          created_at: string
          decided_at: string | null
          entry_at: string
          exit_at: string | null
          expected_at: string | null
          flat_id: string | null
          flat_number: string | null
          gate_pass_code: string | null
          id: string
          logged_by: string
          notes: string | null
          override_reason: string | null
          overstay_notified_at: string | null
          parking_slot_id: string | null
          phone: string | null
          pre_approved: boolean
          purpose: string | null
          recurring_pass_id: string | null
          restriction_id: string | null
          society_id: string
          status: string
          valid_until: string | null
          vehicle_number: string | null
          visitor_name: string
        }
        Insert: {
          approved_by?: string | null
          category?: string
          created_at?: string
          decided_at?: string | null
          entry_at?: string
          exit_at?: string | null
          expected_at?: string | null
          flat_id?: string | null
          flat_number?: string | null
          gate_pass_code?: string | null
          id?: string
          logged_by: string
          notes?: string | null
          override_reason?: string | null
          overstay_notified_at?: string | null
          parking_slot_id?: string | null
          phone?: string | null
          pre_approved?: boolean
          purpose?: string | null
          recurring_pass_id?: string | null
          restriction_id?: string | null
          society_id: string
          status?: string
          valid_until?: string | null
          vehicle_number?: string | null
          visitor_name: string
        }
        Update: {
          approved_by?: string | null
          category?: string
          created_at?: string
          decided_at?: string | null
          entry_at?: string
          exit_at?: string | null
          expected_at?: string | null
          flat_id?: string | null
          flat_number?: string | null
          gate_pass_code?: string | null
          id?: string
          logged_by?: string
          notes?: string | null
          override_reason?: string | null
          overstay_notified_at?: string | null
          parking_slot_id?: string | null
          phone?: string | null
          pre_approved?: boolean
          purpose?: string | null
          recurring_pass_id?: string | null
          restriction_id?: string | null
          society_id?: string
          status?: string
          valid_until?: string | null
          vehicle_number?: string | null
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitors_parking_slot_id_fkey"
            columns: ["parking_slot_id"]
            isOneToOne: false
            referencedRelation: "parking_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          amount: number
          bank_account: string | null
          bank_ifsc: string | null
          created_at: string
          id: string
          method: string
          status: string
          updated_at: string
          upi_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          bank_account?: string | null
          bank_ifsc?: string | null
          created_at?: string
          id?: string
          method?: string
          status?: string
          updated_at?: string
          upi_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          bank_account?: string | null
          bank_ifsc?: string | null
          created_at?: string
          id?: string
          method?: string
          status?: string
          updated_at?: string
          upi_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      society_leaderboard: {
        Row: {
          achievement_count: number | null
          avatar_url: string | null
          full_name: string | null
          society_id: string | null
          total_points: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _agm_audit: {
        Args: {
          _a: Database["public"]["Tables"]["agms"]["Row"]
          _action: string
          _meta: Json
        }
        Returns: undefined
      }
      _agm_quorum: {
        Args: { _a: Database["public"]["Tables"]["agms"]["Row"] }
        Returns: Json
      }
      _allocate_bill_number: {
        Args: { _period_start: string; _prefix?: string; _society_id: string }
        Returns: string
      }
      _allocate_receipt_number: {
        Args: { _now: string; _society_id: string }
        Returns: string
      }
      _allocate_receipt_number_monthly: {
        Args: { _now: string; _society_id: string }
        Returns: string
      }
      _allocate_saas_receipt_number: {
        Args: { _issued_at?: string }
        Returns: string
      }
      _amenity_admin: { Args: { _society_id: string }; Returns: boolean }
      _amenity_eligibility: {
        Args: { _amenity_id: string; _flat: string; _uid: string }
        Returns: string
      }
      _amenity_revalidate_booking: {
        Args: { _booking_id: string }
        Returns: boolean
      }
      _auth_session_id: { Args: never; Returns: string }
      _authorize_membership_internal: {
        Args: { _society_id: string; _user_id: string }
        Returns: boolean
      }
      _bank_line_candidates: {
        Args: { _days: number; _line_id: string }
        Returns: {
          already_reconciled: boolean
          amount: number
          kind: string
          label: string
          record_date: string
          record_id: string
          reference: string
          score: number
        }[]
      }
      _bank_lock_line_society: {
        Args: { _line_id: string }
        Returns: undefined
      }
      _bank_refresh_suggestions: {
        Args: { _society_id: string }
        Returns: number
      }
      _bill_outstanding: { Args: { _bill_id: string }; Returns: number }
      _bill_run_fingerprint: {
        Args: { _cycle_config_id: string; _society_id: string }
        Returns: string
      }
      _bill_run_rows: {
        Args: { _cycle_config_id: string; _society_id: string }
        Returns: {
          area_sqft: number
          current_charges: number
          flat_id: string
          flat_number: string
          late_fee: number
          overdue_balance: number
          previous_balance: number
          problems: string[]
          total: number
          unit_type: string
        }[]
      }
      _billing_audit: {
        Args: {
          _action: string
          _meta: Json
          _society_id: string
          _target_id: string
          _target_table: string
        }
        Returns: undefined
      }
      _billing_require_admin: {
        Args: { _society_id: string }
        Returns: undefined
      }
      _branding_plan_enabled: {
        Args: { _society_id: string }
        Returns: boolean
      }
      _caller_phone_digits: { Args: never; Returns: string }
      _caller_society: { Args: never; Returns: string }
      _can_manage_polls: { Args: { _society_id: string }; Returns: boolean }
      _class_runs_on: {
        Args: {
          _d: string
          c: Database["public"]["Tables"]["amenity_classes"]["Row"]
        }
        Returns: boolean
      }
      _community_member_society: { Args: never; Returns: string }
      _deactivate_resident_role_if_homeless: {
        Args: { _society: string; _user: string }
        Returns: undefined
      }
      _election_audit: {
        Args: {
          _action: string
          _e: Database["public"]["Tables"]["elections"]["Row"]
          _meta: Json
        }
        Returns: undefined
      }
      _election_eligible_count: {
        Args: { _e: Database["public"]["Tables"]["elections"]["Row"] }
        Returns: number
      }
      _election_eligible_users: {
        Args: { _sid: string }
        Returns: {
          user_id: string
        }[]
      }
      _election_notify: {
        Args: {
          _body: string
          _e: Database["public"]["Tables"]["elections"]["Row"]
          _key: string
          _only_non_voters?: boolean
          _title: string
        }
        Returns: number
      }
      _election_tally: {
        Args: { _e: Database["public"]["Tables"]["elections"]["Row"] }
        Returns: Json
      }
      _enqueue_message: {
        Args: {
          _body: string
          _channel: string
          _kind: string
          _soc: string
          _src: string
          _subject: string
          _user: string
        }
        Returns: undefined
      }
      _fin_bs_section: {
        Args: { _as_of: string; _society_id: string }
        Returns: Json
      }
      _fin_ie_section: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: Json
      }
      _fin_manual_balanced: { Args: { _entry: string }; Returns: boolean }
      _fin_period_open: {
        Args: { _d: string; _society_id: string }
        Returns: boolean
      }
      _fin_write_manual_lines: {
        Args: { _entry: string; _lines: Json; _society_id: string }
        Returns: undefined
      }
      _finance_plan_enabled: { Args: { _society_id: string }; Returns: boolean }
      _finance_post_entry: {
        Args: {
          _actor_id: string
          _amount: number
          _credit_system_key: string
          _debit_system_key: string
          _description: string
          _reference: string
          _reversal_of?: string
          _society_id: string
          _source_action: string
          _source_id: string
          _source_type: string
          _transaction_date: string
        }
        Returns: string
      }
      _finance_reader_for: { Args: { _society_id: string }; Returns: boolean }
      _finance_require_admin: { Args: { _society_id: string }; Returns: string }
      _finance_require_reader: {
        Args: { _society_id: string }
        Returns: string
      }
      _finance_seed_accounts: {
        Args: { _actor_id: string; _society_id: string }
        Returns: undefined
      }
      _flat_has_current_occupant: { Args: { _flat: string }; Returns: boolean }
      _gate_admin_society: { Args: never; Returns: string }
      _gate_society: { Args: never; Returns: string }
      _gov_active_owner: {
        Args: { _sid: string; _user: string }
        Returns: boolean
      }
      _gov_active_resident: {
        Args: { _sid: string; _user: string }
        Returns: boolean
      }
      _gov_admin_society: { Args: never; Returns: string }
      _gov_member_society: { Args: never; Returns: string }
      _guard_attention_counts: {
        Args: never
        Returns: {
          incidents: number
          overstay: number
          pending: number
          restricted: number
          sos: number
        }[]
      }
      _guard_open_session: {
        Args: { _device: string; _method: string; _sid: string; _token: string }
        Returns: string
      }
      _guard_role_society: { Args: never; Returns: string }
      _guard_session_ok: { Args: { _sid: string }; Returns: boolean }
      _helpdesk_is_admin: { Args: { _sid: string }; Returns: boolean }
      _helpdesk_report_scope: { Args: never; Returns: Record<string, unknown> }
      _helpdesk_report_tickets: {
        Args: {
          _asset: string
          _category: string
          _flag: string
          _from: string
          _priority: string
          _sid: string
          _staff: string
          _staff_scope: string
          _status: string
          _to: string
          _vendor: string
        }
        Returns: {
          ai_transcript: Json | null
          approval_status: string | null
          asset_id: string | null
          assigned_to: string | null
          category: string
          closed_at: string | null
          created_at: string
          description: string
          escalation_level: number
          escalation_reason: string | null
          hold_reason: string | null
          id: string
          last_activity_at: string
          parent_ticket_id: string | null
          priority: string
          reopened_count: number
          requires_approval: boolean
          resolution_note: string | null
          resolved_at: string | null
          sla_due_at: string | null
          society_id: string | null
          staff_id: string | null
          status: string
          subject: string
          ticket_no: number
          updated_at: string
          user_id: string
          vendor_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _helpdesk_sla_hours: { Args: { _priority: string }; Returns: number }
      _home_link_valid: {
        Args: { _flat: string; _uid: string }
        Returns: boolean
      }
      _import_find_flat: {
        Args: { _block: string; _society_id: string; _unit: string }
        Returns: Record<string, unknown>
      }
      _import_parse_amount: { Args: { _v: string }; Returns: number }
      _import_parse_date: { Args: { _v: string }; Returns: string }
      _knowledge_admin_society: { Args: never; Returns: string }
      _market_log: {
        Args: { _action: string; _l: string; _reason: string; _soc: string }
        Returns: undefined
      }
      _meeting_audience: {
        Args: { _m: Database["public"]["Tables"]["meetings"]["Row"] }
        Returns: {
          user_id: string
        }[]
      }
      _meeting_is_admin: { Args: { _meeting: string }; Returns: boolean }
      _meeting_visible: { Args: { _meeting: string }; Returns: boolean }
      _migration_link_or_conflict: {
        Args: {
          _canonical_entity_id: string
          _entity_type: Database["public"]["Enums"]["migration_entity_type"]
          _job_id: string
          _society_id: string
          _source_checksum: string
          _source_key: string
          _source_type: string
        }
        Returns: undefined
      }
      _my_active_flat: {
        Args: never
        Returns: {
          flat_id: string
          flat_number: string
          society_id: string
        }[]
      }
      _norm_plate: { Args: { _p: string }; Returns: string }
      _notice_admin_society: { Args: never; Returns: string }
      _notice_audience: {
        Args: { _n: Database["public"]["Tables"]["notices"]["Row"] }
        Returns: {
          user_id: string
        }[]
      }
      _notice_visible: {
        Args: { _n: Database["public"]["Tables"]["notices"]["Row"] }
        Returns: boolean
      }
      _notify_flat: {
        Args: {
          _body: string
          _flat: string
          _kind: string
          _link: string
          _society: string
          _title: string
        }
        Returns: undefined
      }
      _notify_flat_once: {
        Args: {
          _body: string
          _flat: string
          _key: string
          _kind: string
          _link: string
          _priority?: string
          _sid: string
          _title: string
        }
        Returns: number
      }
      _notify_gate_staff: {
        Args: {
          _admins_only?: boolean
          _body: string
          _kind: string
          _link: string
          _sid: string
          _title: string
        }
        Returns: undefined
      }
      _notify_gate_staff_once: {
        Args: {
          _body: string
          _key: string
          _kind: string
          _link: string
          _priority?: string
          _sid: string
          _title: string
        }
        Returns: number
      }
      _notify_society_admins: {
        Args: {
          _body: string
          _kind: string
          _link: string
          _sid: string
          _title: string
        }
        Returns: undefined
      }
      _notify_society_admins_once: {
        Args: {
          _body: string
          _key: string
          _kind: string
          _link: string
          _priority?: string
          _sid: string
          _title: string
        }
        Returns: number
      }
      _notify_user: {
        Args: {
          _body: string
          _kind: string
          _link: string
          _society: string
          _title: string
          _user: string
        }
        Returns: undefined
      }
      _notify_user_once: {
        Args: {
          _body: string
          _dedupe_key: string
          _kind: string
          _link: string
          _priority?: string
          _society: string
          _title: string
          _user: string
        }
        Returns: boolean
      }
      _online_maintenance_enabled: {
        Args: { _society_id: string }
        Returns: boolean
      }
      _ops_admin: { Args: { _sid: string }; Returns: string }
      _parking_admin_society: { Args: never; Returns: string }
      _parking_audit: {
        Args: {
          _action: string
          _id: string
          _meta: Json
          _sid: string
          _target: string
        }
        Returns: undefined
      }
      _parking_release_internal: {
        Args: { _alloc: string; _effective: string; _reason: string }
        Returns: Record<string, unknown>
      }
      _parking_resolve_holder: {
        Args: {
          _flat: string
          _require_occupant: boolean
          _sid: string
          _vehicle: string
        }
        Returns: string
      }
      _proc_att_state_ok: {
        Args: { _kind: string; _status: string }
        Returns: boolean
      }
      _proc_auth: { Args: { _sid: string }; Returns: string }
      _proc_clean: { Args: { _max: number; _t: string }; Returns: string }
      _proc_lock: {
        Args: { _id: string }
        Returns: {
          approved_amount: number | null
          cancel_reason: string | null
          category: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          description: string | null
          estimated_amount: number | null
          expense_id: string | null
          fy_start: number
          id: string
          invoice_amount: number | null
          invoice_date: string | null
          invoice_ref: string | null
          needed_by: string | null
          order_ref: string | null
          ordered_at: string | null
          payment_ref: string | null
          request_no: number
          requested_by: string
          selected_quotation_id: string | null
          society_id: string
          status: string
          title: string
          updated_at: string
          vendor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "procurement_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _proc_log: {
        Args: {
          _action: string
          _from: string
          _note: string
          _r: Database["public"]["Tables"]["procurement_requests"]["Row"]
          _to: string
          _uid: string
        }
        Returns: undefined
      }
      _proc_money: { Args: { _v: number }; Returns: number }
      _promote_amenity_waitlist: {
        Args: { _actor: string; _freed_id: string }
        Returns: number
      }
      _rate_hit: {
        Args: {
          _bucket: string
          _max: number
          _subject: string
          _window: string
        }
        Returns: undefined
      }
      _roles_admin_society: { Args: never; Returns: string }
      _sec_admin_society: { Args: never; Returns: string }
      _staff_asset_ids: {
        Args: { _society: string; _staff: string }
        Returns: {
          asset_id: string
        }[]
      }
      _staff_assigned_ticket: { Args: { _ticket: string }; Returns: boolean }
      _staff_ctx: { Args: { _cap: string }; Returns: Record<string, unknown> }
      _staff_permission_valid: { Args: { _perms: string[] }; Returns: boolean }
      _survey_notify: { Args: { _poll_id: string }; Returns: undefined }
      _sync_bill_payment_state: {
        Args: { _bill_id: string }
        Returns: undefined
      }
      _tenancy_row_society: {
        Args: { _flat_resident_id: string }
        Returns: string
      }
      _upi_rate_ok: {
        Args: { _bucket: string; _limit: number; _subject: string }
        Returns: undefined
      }
      _vehicle_authorized_slots: { Args: { _vehicle: string }; Returns: string }
      _visitor_clean: { Args: { _max: number; _t: string }; Returns: string }
      _visitor_new_code: { Args: { _society: string }; Returns: string }
      _visitor_restriction_match: {
        Args: { _name: string; _phone: string; _sid: string }
        Returns: string
      }
      _vote_eligible_flat: {
        Args: {
          _p: Database["public"]["Tables"]["polls"]["Row"]
          _user: string
        }
        Returns: {
          eligible: boolean
          flat_id: string
        }[]
      }
      activate_society_plan: {
        Args: { _months?: number; _plan_id: string; _society_id: string }
        Returns: undefined
      }
      add_temporary_occupant: {
        Args: {
          _from: string
          _name: string
          _phone: string
          _relation: string
          _until: string
        }
        Returns: string
      }
      admin_active_people: { Args: never; Returns: Json }
      admin_add_asset_service: {
        Args: {
          _asset: string
          _date: string
          _expense: string
          _kind: string
          _notes: string
          _ticket: string
          _vendor: string
        }
        Returns: string
      }
      admin_add_bill_adjustment: {
        Args: {
          _amount: number
          _bill_id: string
          _counter_of?: string
          _reason: string
          _request_id: string
          _society_id: string
        }
        Returns: Json
      }
      admin_adjust_inventory: {
        Args: { _delta: number; _item: string; _reason: string }
        Returns: number
      }
      admin_apply_custom_plan:
        | { Args: { _custom_plan_id: string }; Returns: boolean }
        | {
            Args: { _custom_plan_id: string; _reason: string }
            Returns: boolean
          }
      admin_archive_tenancy: {
        Args: { _flat_resident_id: string }
        Returns: undefined
      }
      admin_assign_resident_to_flat:
        | {
            Args: {
              _flat_id: string
              _is_primary?: boolean
              _relationship?: string
              _user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _flat_id: string
              _is_primary?: boolean
              _lease_ends_on?: string
              _lease_starts_on?: string
              _relationship?: string
              _user_id: string
            }
            Returns: string
          }
      admin_calculate_expense_tax: {
        Args: {
          _expense_id: string
          _gst_rate?: number
          _includes_gst?: boolean
          _supply_type?: string
          _tds_rate?: number
          _tds_section?: string
        }
        Returns: Json
      }
      admin_cancel_class: {
        Args: { _class_id: string; _reason: string }
        Returns: undefined
      }
      admin_cancel_event: {
        Args: { _event_id: string; _reason: string }
        Returns: undefined
      }
      admin_cancel_maintenance: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      admin_cancel_patrol_round: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      admin_cancel_role_invitation: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      admin_cancel_society_plan: {
        Args: { _reason: string; _society_id: string }
        Returns: Json
      }
      admin_create_class: {
        Args: {
          _amenity_id: string
          _capacity: number
          _description: string
          _duration: number
          _ends_on: string
          _instructor_id: string
          _start_time: string
          _starts_on: string
          _title: string
          _weekdays: number[]
        }
        Returns: string
      }
      admin_create_event: {
        Args: {
          _capacity: number
          _description: string
          _ends_at: string
          _society_id: string
          _starts_at: string
          _title: string
          _venue: string
        }
        Returns: string
      }
      admin_create_survey: {
        Args: {
          _closes_at: string
          _description: string
          _publish: boolean
          _questions: Json
          _society_id: string
          _title: string
        }
        Returns: string
      }
      admin_delete_family_member: {
        Args: { _id: string; _society_id: string }
        Returns: undefined
      }
      admin_delete_vehicle: {
        Args: { _id: string; _society_id: string }
        Returns: undefined
      }
      admin_ev_charger_retire: { Args: { _id: string }; Returns: undefined }
      admin_ev_charger_save: {
        Args: {
          _connector: string
          _id: string
          _name: string
          _provider: string
          _rated_kw: number
          _slot_id: string
          _status: string
        }
        Returns: string
      }
      admin_event_attendees: {
        Args: { _event_id: string }
        Returns: {
          created_at: string
          full_name: string
          guests: number
          homes: string
          status: string
        }[]
      }
      admin_extend_trial: {
        Args: { _days: number; _reason: string; _society_id: string }
        Returns: Json
      }
      admin_get_society_upi: { Args: { _society_id: string }; Returns: Json }
      admin_global_metrics: {
        Args: never
        Returns: {
          active_societies: number
          paid_amount_30d: number
          paid_bills_30d: number
          total_societies: number
          total_users: number
          trialing_societies: number
          visitors_today: number
        }[]
      }
      admin_grant_society_plan:
        | {
            Args: {
              _extend?: boolean
              _months?: number
              _plan_id: string
              _society_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _extend: boolean
              _months: number
              _plan_id: string
              _reason: string
              _society_id: string
            }
            Returns: undefined
          }
      admin_group_action: {
        Args: { _action: string; _group_id: string; _user_id?: string }
        Returns: undefined
      }
      admin_income_summary: {
        Args: never
        Returns: {
          collected_30d: number
          collected_total: number
          custom_mrr: number
          custom_priced_societies: number
          plans: Json
          standard_paid_societies: number
          subscription_mrr: number
          total_revenue: number
        }[]
      }
      admin_invite_role: {
        Args: {
          _name: string
          _permissions: string[]
          _phone: string
          _role: string
          _staff: string
        }
        Returns: string
      }
      admin_issue_class_checkin_code: {
        Args: { _class_id: string }
        Returns: Json
      }
      admin_issue_guard_entry_token: {
        Args: { _guard_user_id: string }
        Returns: Json
      }
      admin_list_gate_guards: {
        Args: never
        Returns: {
          active_session_id: string
          blocked: boolean
          device_label: string
          expires_at: string
          full_name: string
          last_seen_at: string
          method: string
          phone_last4: string
          started_at: string
          user_id: string
        }[]
      }
      admin_list_refund_needed_orders: {
        Args: { _society_id: string }
        Returns: {
          amount_paise: number
          created_at: string
          failure_code: string
          flat_number: string
          id: string
          razorpay_payment_id: string
          refund_note: string
          refund_reference: string
          refund_resolved_at: string
        }[]
      }
      admin_list_role_access: { Args: never; Returns: Json }
      admin_list_societies: {
        Args: never
        Returns: {
          created_at: string
          id: string
          name: string
          plan_expires_at: string
          plan_id: string
          plan_status: string
          status: string
        }[]
      }
      admin_list_societies_v2: {
        Args: never
        Returns: {
          admin_count: number
          city: string
          created_at: string
          id: string
          member_count: number
          name: string
          plan_expires_at: string
          plan_id: string
          plan_status: string
          status: string
          trial_ends_at: string
          unit_count: number
        }[]
      }
      admin_list_society_residents: {
        Args: { _society_id: string }
        Returns: {
          email: string
          flat_count: number
          flats: Json
          full_name: string
          phone: string
          user_id: string
        }[]
      }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
          plan_expires_at: string
          plan_id: string
          plan_status: string
          roles: Json
          society_id: string
          society_name: string
        }[]
      }
      admin_mark_class_attendance: {
        Args: {
          _class_id: string
          _enrollment_ids: string[]
          _session_date: string
        }
        Returns: number
      }
      admin_mark_order_refunded: {
        Args: { _note: string; _order_id: string; _reference: string }
        Returns: undefined
      }
      admin_messaging_overview: { Args: never; Returns: Json }
      admin_moderate_vendor_rating: {
        Args: { _hide: boolean; _id: string; _reason: string }
        Returns: undefined
      }
      admin_move_out_resident: {
        Args: {
          _early_termination?: boolean
          _flat_resident_id: string
          _moved_out_on: string
          _override_reason?: string
          _reason: string
        }
        Returns: Json
      }
      admin_notice_ack_roster: {
        Args: { _notice_id: string }
        Returns: {
          acked_at: string
          full_name: string
          homes: string
          opened_at: string
        }[]
      }
      admin_parking_archive: { Args: { _id: string }; Returns: undefined }
      admin_parking_assign: {
        Args: {
          _flat_id: string
          _reason: string
          _slot_id: string
          _vehicle_id: string
        }
        Returns: string
      }
      admin_parking_capacity: {
        Args: { _block_id?: string; _floor?: string; _slot_type?: string }
        Returns: Json
      }
      admin_parking_reallocate: {
        Args: {
          _flat_id: string
          _reason: string
          _slot_id: string
          _vehicle_id: string
        }
        Returns: string
      }
      admin_parking_release: {
        Args: {
          _allocation_id: string
          _effective_at?: string
          _reason: string
        }
        Returns: undefined
      }
      admin_parking_report: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      admin_parking_slot_save: {
        Args: {
          _availability: string
          _block_id: string
          _ev_capable: boolean
          _floor: string
          _id: string
          _label: string
          _notes: string
          _slot_type: string
        }
        Returns: string
      }
      admin_parking_temp_allocate: {
        Args: {
          _ends_at: string
          _flat_id: string
          _purpose: string
          _reason: string
          _slot_id: string
          _starts_at: string
          _vehicle_id: string
        }
        Returns: string
      }
      admin_parking_upsert: {
        Args: {
          _flat_id: string
          _id: string
          _label: string
          _notes: string
          _slot_type: string
          _vehicle_id: string
        }
        Returns: string
      }
      admin_parking_violation_update: {
        Args: { _id: string; _note: string; _status: string }
        Returns: undefined
      }
      admin_patrol_overview: { Args: { _days?: number }; Returns: Json }
      admin_petty_cash_entry: {
        Args: {
          _amount: number
          _entry_date: string
          _kind: string
          _paid_to: string
          _purpose: string
          _request_id: string
          _reverses: string
          _society_id: string
          _voucher_no: string
        }
        Returns: Json
      }
      admin_platform_overview: { Args: never; Returns: Json }
      admin_platform_summary: {
        Args: never
        Returns: {
          active_societies: number
          successful_payment_total: number
          total_societies: number
          total_users: number
          trialing_societies: number
          unpaid_bill_total: number
        }[]
      }
      admin_rate_vendor_service: {
        Args: { _comment: string; _log: string; _rating: number }
        Returns: string
      }
      admin_record_attendance: {
        Args: { _day: string; _note: string; _staff: string; _status: string }
        Returns: undefined
      }
      admin_record_meter_reading: {
        Args: {
          _meter_id: string
          _note: string
          _reading: number
          _reading_date: string
        }
        Returns: Json
      }
      admin_record_platform_cost: {
        Args: {
          _amount: number
          _category: string
          _note: string
          _period: string
        }
        Returns: Json
      }
      admin_register_meter: {
        Args: {
          _flat_id: string
          _label: string
          _meter_number: string
          _replaces?: string
          _society_id: string
          _utility: string
        }
        Returns: string
      }
      admin_register_rfid: {
        Args: {
          _flat_id: string
          _label: string
          _raw: string
          _vehicle_id: string
        }
        Returns: string
      }
      admin_renew_tenancy: {
        Args: { _flat_resident_id: string; _new_lease_ends_on: string }
        Returns: undefined
      }
      admin_reset_society_branding: {
        Args: { _society_id: string }
        Returns: Json
      }
      admin_retry_failed_messages: {
        Args: { _channel: string; _reason: string }
        Returns: number
      }
      admin_revoke_guard_access: {
        Args: { _guard_user_id: string; _reason: string }
        Returns: Json
      }
      admin_revoke_rfid: { Args: { _id: string }; Returns: undefined }
      admin_save_group: {
        Args: {
          _description: string
          _join_policy: string
          _kind: string
          _name: string
          _society_id: string
        }
        Returns: string
      }
      admin_save_instructor: {
        Args: {
          _active: boolean
          _id: string
          _name: string
          _phone: string
          _society_id: string
          _specialty: string
        }
        Returns: string
      }
      admin_schedule_maintenance: {
        Args: {
          _asset: string
          _due: string
          _instructions: string
          _staff: string
          _title: string
        }
        Returns: string
      }
      admin_schedule_patrol_rounds: {
        Args: {
          _days?: number
          _first_start: string
          _guard: string
          _route_id: string
          _window_minutes: number
        }
        Returns: number
      }
      admin_set_ai_cost_rate: {
        Args: { _rate: number; _reason: string }
        Returns: Json
      }
      admin_set_amenity_block: {
        Args: {
          _amenity_id: string
          _blocked: boolean
          _blocked_date: string
          _reason: string
        }
        Returns: undefined
      }
      admin_set_amenity_booking_status: {
        Args: { _booking_id: string; _status: string }
        Returns: undefined
      }
      admin_set_amenity_household_policy: {
        Args: { _amenity_id: string; _household_allowed: boolean }
        Returns: undefined
      }
      admin_set_asset_depreciation: {
        Args: {
          _asset_id: string
          _cost: number
          _life_years: number
          _method: string
          _salvage: number
          _start_date: string
          _wdv_rate: number
        }
        Returns: undefined
      }
      admin_set_billing_controls: {
        Args: {
          _approval_required: boolean
          _late_fee_enabled: boolean
          _society_id: string
        }
        Returns: Json
      }
      admin_set_handover_status: {
        Args: { _note?: string; _society_id: string; _status: string }
        Returns: Json
      }
      admin_set_messaging_channel: {
        Args: { _channel: string; _enabled: boolean; _reason: string }
        Returns: undefined
      }
      admin_set_role_access: {
        Args: { _active: boolean; _reason: string; _role_id: string }
        Returns: undefined
      }
      admin_set_society_automation: {
        Args: {
          _config?: Json
          _enabled: boolean
          _key: string
          _society_id: string
        }
        Returns: Json
      }
      admin_set_society_branding: {
        Args: {
          _accent_color: string
          _display_name: string
          _logo_path: string
          _primary_color: string
          _society_id: string
        }
        Returns: Json
      }
      admin_set_society_privacy: {
        Args: {
          _contacts: string
          _directory: string
          _documents: string
          _finances: string
          _society_id: string
          _vehicles: string
        }
        Returns: undefined
      }
      admin_set_society_status: {
        Args: { _reason: string; _society_id: string; _status: string }
        Returns: Json
      }
      admin_set_society_tax_settings: {
        Args: {
          _gst_registered: boolean
          _gst_state_code: string
          _society_id: string
          _tan: string
          _tds_deductor: boolean
        }
        Returns: undefined
      }
      admin_set_society_upi: {
        Args: {
          _enabled: boolean
          _keep_qr: boolean
          _payee_name: string
          _qr_path: string
          _society_id: string
          _upi_vpa: string
        }
        Returns: undefined
      }
      admin_set_staff_permissions: {
        Args: { _permissions: string[]; _role_id: string }
        Returns: undefined
      }
      admin_set_survey_status: {
        Args: { _poll_id: string; _status: string }
        Returns: undefined
      }
      admin_set_team_active: {
        Args: { _is_active: boolean; _role_id: string; _society_id: string }
        Returns: string
      }
      admin_set_tenancy_terms: {
        Args: {
          _flat_resident_id: string
          _lease_ends_on?: string
          _lease_starts_on?: string
          _notice_given_on?: string
          _society_id: string
        }
        Returns: undefined
      }
      admin_set_tenancy_warning_days: {
        Args: { _days: number; _society_id: string }
        Returns: undefined
      }
      admin_set_vendor_contract: {
        Args: {
          _end: string
          _notes: string
          _start: string
          _type: string
          _value: number
          _vendor: string
        }
        Returns: undefined
      }
      admin_set_vendor_tax: {
        Args: {
          _gst_rate: number
          _gstin: string
          _pan: string
          _state_code: string
          _tds_rate: number
          _tds_section: string
          _vendor_id: string
        }
        Returns: undefined
      }
      admin_society_diagnose: { Args: { _society_id: string }; Returns: Json }
      admin_society_health_list: {
        Args: never
        Returns: {
          admins: number
          ai_requests_30d: number
          city: string
          created_at: string
          declared_units: number
          failed_payments: number
          flats: number
          guards: number
          id: string
          last_activity_at: string
          name: string
          open_incidents: number
          open_tickets: number
          overdue_tickets: number
          pending_joins: number
          plan_expires_at: string
          plan_id: string
          plan_status: string
          residents: number
          staff: number
          status: string
          trial_ends_at: string
        }[]
      }
      admin_society_overview: { Args: { _society_id: string }; Returns: Json }
      admin_transition_withdrawal: {
        Args: { _reason: string; _status: string; _withdrawal_id: string }
        Returns: undefined
      }
      admin_upsert_amenity: {
        Args: {
          _advance_days: number
          _amenity_type: string
          _cancellation_hours: number
          _capacity: number
          _closes_at: string
          _defaulters_allowed: boolean
          _deposit_amount: number
          _description: string
          _fee_amount: number
          _id: string
          _is_active: boolean
          _name: string
          _opens_at: string
          _owner_allowed: boolean
          _slot_minutes: number
          _society_id: string
          _tenant_allowed: boolean
          _weekly_household_limit: number
        }
        Returns: string
      }
      admin_upsert_asset: {
        Args: {
          _amc: string
          _category: string
          _id: string
          _installed: string
          _location: string
          _name: string
          _notes: string
          _purchase: string
          _status: string
          _vendor: string
          _warranty: string
        }
        Returns: string
      }
      admin_upsert_family_member: {
        Args: {
          _age?: number
          _full_name?: string
          _id?: string
          _phone?: string
          _relation?: string
          _resident_user_id: string
          _society_id: string
        }
        Returns: string
      }
      admin_upsert_gate_device: {
        Args: {
          _gate_label: string
          _id: string
          _kind: string
          _name: string
          _provider: string
          _rotate_key?: boolean
          _status: string
        }
        Returns: Json
      }
      admin_upsert_inventory_item: {
        Args: {
          _active: boolean
          _id: string
          _location: string
          _name: string
          _reorder: number
          _unit: string
        }
        Returns: string
      }
      admin_upsert_patrol_route: {
        Args: {
          _active?: boolean
          _checkpoints: Json
          _id: string
          _name: string
        }
        Returns: string
      }
      admin_upsert_staff: {
        Args: {
          _active: boolean
          _days: number[]
          _id: string
          _job: string
          _name: string
          _notes: string
          _phone: string
          _shift_end: string
          _shift_start: string
        }
        Returns: string
      }
      admin_upsert_team_role: {
        Args: {
          _block_id?: string
          _new_role: Database["public"]["Enums"]["app_role"]
          _society_id: string
          _target_user_id: string
        }
        Returns: string
      }
      admin_upsert_team_role_v2: {
        Args: {
          _block_ids?: string[]
          _new_role: Database["public"]["Enums"]["app_role"]
          _society_id: string
          _target_user_id: string
        }
        Returns: string
      }
      admin_upsert_vehicle: {
        Args: {
          _color?: string
          _flat_id?: string
          _id?: string
          _make_model?: string
          _plate_number?: string
          _resident_user_id?: string
          _society_id: string
          _type?: string
        }
        Returns: string
      }
      admin_upsert_visitor_restriction: {
        Args: {
          _active: boolean
          _id: string
          _name: string
          _phone: string
          _reason: string
        }
        Returns: string
      }
      admin_visitor_decide: {
        Args: { _action: string; _id: string; _reason: string }
        Returns: undefined
      }
      admin_void_platform_cost: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      agm_agenda_move: {
        Args: { _dir: number; _item: string }
        Returns: undefined
      }
      agm_agenda_remove: { Args: { _item: string }; Returns: undefined }
      agm_agenda_save: {
        Args: {
          _agm: string
          _description: string
          _election: string
          _item: string
          _kind: string
          _poll: string
          _source: string
          _title: string
        }
        Returns: string
      }
      agm_minutes_save: {
        Args: { _agm: string; _body: string; _correction_reason: string }
        Returns: string
      }
      agm_quorum: { Args: { _agm: string }; Returns: Json }
      agm_record_attendance: {
        Args: {
          _agm: string
          _present: boolean
          _reason: string
          _user: string
        }
        Returns: undefined
      }
      agm_resolution_add: {
        Args: {
          _agenda_item: string
          _agm: string
          _body: string
          _poll: string
          _title: string
        }
        Returns: string
      }
      agm_resolution_decide: {
        Args: { _resolution: string; _status: string }
        Returns: undefined
      }
      agm_save: {
        Args: {
          _agenda: string
          _basis: string
          _fy: string
          _id: string
          _link: string
          _location: string
          _qtype: string
          _qvalue: number
          _starts: string
          _title: string
        }
        Returns: string
      }
      agm_set_status: {
        Args: { _id: string; _reason: string; _status: string }
        Returns: undefined
      }
      apply_overdue_point_decay: { Args: never; Returns: number }
      apply_referral_for_current_user: {
        Args: { _code: string }
        Returns: boolean
      }
      apply_society_structure_plan_internal: {
        Args: { _actor_id: string; _plan: Json; _society_id: string }
        Returns: Json
      }
      archive_billing_template_line: {
        Args: { _id: string; _society_id: string }
        Returns: undefined
      }
      asset_qr_lookup: {
        Args: { _token: string }
        Returns: {
          category: string
          location: string
          name: string
          status: string
        }[]
      }
      assign_resident_to_unit: {
        Args: {
          _flat_id: string
          _is_primary?: boolean
          _moved_in_at?: string
          _relationship: string
          _society_id: string
          _user_id: string
        }
        Returns: string
      }
      attach_maintenance_razorpay_order: {
        Args: { _order_id: string; _razorpay_order_id: string }
        Returns: undefined
      }
      auditor_finance_history: {
        Args: { _from: string; _limit?: number; _offset?: number; _to: string }
        Returns: {
          action: string
          actor_name: string
          at: string
          metadata: Json
          target_id: string
          target_table: string
        }[]
      }
      authorize_membership: {
        Args: { _society_id: string; _user_id: string }
        Returns: boolean
      }
      bill_run_insert_period: {
        Args: {
          _period_end: string
          _period_start: string
          _rows: Json
          _society_id: string
        }
        Returns: number
      }
      book_amenity: {
        Args: {
          _amenity_id: string
          _attendees: number
          _idempotency_key: string
          _starts_at: string
        }
        Returns: {
          id: string
          status: string
        }[]
      }
      budget_set: {
        Args: {
          _amount: number
          _category: string
          _fy_start: number
          _notes: string
          _reason: string
        }
        Returns: string
      }
      bulk_approve_join_requests: {
        Args: { _request_ids: string[]; _society_id: string }
        Returns: number
      }
      bulk_generate_society_hierarchy: {
        Args: { _blocks: Json; _society_id: string }
        Returns: {
          blocks_created: number
          flats_created: number
        }[]
      }
      bulk_reject_join_requests: {
        Args: { _reason?: string; _request_ids: string[]; _society_id: string }
        Returns: number
      }
      can_access_vehicle: {
        Args: { _society_id: string; _vehicle_id: string }
        Returns: boolean
      }
      can_manage_flat_internal: {
        Args: { _actor_id: string; _flat_id: string }
        Returns: boolean
      }
      cancel_amenity_booking: {
        Args: { _booking_id: string; _reason?: string }
        Returns: undefined
      }
      cancel_bill:
        | { Args: { _bill_id: string; _reason: string }; Returns: undefined }
        | {
            Args: { _bill_id: string; _reason: string; _society_id: string }
            Returns: Json
          }
      cancel_material_pass: { Args: { _pass_id: string }; Returns: undefined }
      check_in_class: { Args: { _class_id: string }; Returns: undefined }
      check_in_class_qr: { Args: { _token: string }; Returns: string }
      claim_maintenance_payment_order: {
        Args: { _bill_id: string; _request_id: string }
        Returns: Json
      }
      claim_saas_subscription_order: {
        Args: {
          _amount_paise: number
          _currency: string
          _plan_id: string
          _provider_mode: string
          _request_id: string
          _requested_by: string
          _society_id: string
        }
        Returns: Json
      }
      claim_saas_subscription_refund: {
        Args: {
          _payment_id: string
          _reason: string
          _request_id: string
          _requested_by: string
        }
        Returns: Json
      }
      close_expired_votes: { Args: never; Returns: number }
      commit_migration_job: {
        Args: {
          _expected_checksum: string
          _job_id: string
          _request_id: string
        }
        Returns: Json
      }
      commit_society_wizard: {
        Args: { _payload: Json; _society_id: string }
        Returns: undefined
      }
      compare_migration_units: {
        Args: { _rows: Json; _society_id: string }
        Returns: Json
      }
      complete_saas_subscription_order: {
        Args: { _razorpay_order_id: string; _request_record_id: string }
        Returns: string
      }
      complete_setup_wizard: {
        Args: { _society_id: string }
        Returns: undefined
      }
      compute_no_dues_eligibility_internal: {
        Args: { _flat_id: string; _society_id: string }
        Returns: Json
      }
      configure_billing_cycle: {
        Args: {
          _cycle_name: string
          _due_date: string
          _id: string
          _period_end: string
          _period_start: string
          _society_id: string
          _status: string
          _template_id: string
        }
        Returns: string
      }
      configure_society_structure_mode: {
        Args: { _mode: string; _society_id: string }
        Returns: Json
      }
      confirm_bank_line_match: {
        Args: { _kind: string; _line_id: string; _record_id: string }
        Returns: Json
      }
      confirm_income_category: {
        Args: {
          _category_id: string
          _expected_revision?: string
          _record_id: string
          _request_id: string
        }
        Returns: Json
      }
      create_finance_expense: {
        Args: {
          _amount: number
          _category: string
          _description: string
          _expense_date: string
          _payment_method: string
          _request_id: string
          _society_id: string
          _vendor_id: string
        }
        Returns: Json
      }
      create_non_member_income_record: {
        Args: {
          _amount: number
          _category_id: string
          _creation_request_id: string
          _description: string
          _non_member_payer_id: string
          _payer_kind: string
          _payment_date: string
          _payment_method: string
          _reference_number: string
          _resident_user_id: string
          _society_id: string
        }
        Returns: Json
      }
      create_oneoff_bills:
        | {
            Args: {
              _amount: number
              _block_id: string
              _due_date: string
              _flat_id: string
              _scope: string
              _society_id: string
              _title: string
            }
            Returns: number
          }
        | {
            Args: {
              _amount: number
              _block_id: string
              _due_date: string
              _flat_id: string
              _label: string
              _notes: string
              _society_id: string
              _target: string
            }
            Returns: number
          }
      create_society_for_current_user: {
        Args: {
          _city?: string
          _name: string
          _referral_code?: string
          _state?: string
        }
        Returns: {
          id: string
          invite_code: string
          name: string
        }[]
      }
      create_society_full: {
        Args: {
          _city?: string
          _full_address?: string
          _logo_url?: string
          _name: string
          _pincode?: string
          _referral_code?: string
          _registration_number?: string
          _state?: string
          _total_units?: number
        }
        Returns: {
          id: string
          invite_code: string
          name: string
        }[]
      }
      create_society_unit: {
        Args: {
          _block_id?: string
          _flat_number: string
          _floor?: number
          _society_id: string
          _unit_type?: string
        }
        Returns: Json
      }
      create_visitor_preapproval: {
        Args: {
          _expected_at: string
          _flat_id: string
          _phone: string
          _purpose: string
          _society_id: string
          _vehicle_number: string
          _visitor_name: string
        }
        Returns: {
          gate_pass_code: string
          id: string
        }[]
      }
      current_home_flat_id: { Args: never; Returns: string }
      current_user_can_admin_migrations: {
        Args: { _society_id: string }
        Returns: boolean
      }
      current_user_can_manage_flat: {
        Args: { _flat_id: string }
        Returns: boolean
      }
      current_user_has_society_permission:
        | {
            Args: { _capability: string; _society_id: string }
            Returns: boolean
          }
        | {
            Args: {
              _block_id?: string
              _capability: string
              _society_id: string
            }
            Returns: boolean
          }
      current_user_is_society_admin_for: {
        Args: { _society_id: string }
        Returns: boolean
      }
      current_user_is_super_admin: { Args: never; Returns: boolean }
      deactivate_finance_vendor: {
        Args: { _vendor_id: string }
        Returns: undefined
      }
      deactivate_flat_resident: {
        Args: { _flat_resident_id: string; _reason?: string }
        Returns: undefined
      }
      decide_bill_run_approval: {
        Args: { _approval_id: string; _approve: boolean; _note: string }
        Returns: Json
      }
      decide_material_pass: {
        Args: { _approve: boolean; _pass_id: string; _reason: string }
        Returns: undefined
      }
      device_ingest_event: {
        Args: { _device_id: string; _event: Json; _key: string }
        Returns: Json
      }
      doc_set_expiry: {
        Args: {
          _audience: string
          _expires_on: string
          _id: string
          _reminder_days: number[]
        }
        Returns: undefined
      }
      duplicate_society_block_internal: {
        Args: { _actor_id: string; _block_id: string; _new_name: string }
        Returns: Json
      }
      election_cast_ballot: {
        Args: { _choices: string[]; _election: string; _request: string }
        Returns: string
      }
      election_my_state: { Args: { _election: string }; Returns: Json }
      election_nominate: {
        Args: { _post: string; _statement: string }
        Returns: string
      }
      election_post_remove: { Args: { _post: string }; Returns: undefined }
      election_post_save: {
        Args: {
          _description: string
          _election: string
          _name: string
          _post: string
          _requirements: string
          _rule: string
          _seats: number
        }
        Returns: string
      }
      election_reminders: { Args: never; Returns: number }
      election_results: { Args: { _election: string }; Returns: Json }
      election_review_nomination: {
        Args: { _approve: boolean; _nomination: string; _reason: string }
        Returns: undefined
      }
      election_save: {
        Args: {
          _agm: string
          _eligibility: string
          _id: string
          _instructions: string
          _nom_close: string
          _nom_open: string
          _purpose: string
          _rules_source: string
          _secret: boolean
          _title: string
          _vote_close: string
          _vote_open: string
        }
        Returns: string
      }
      election_set_status: {
        Args: { _id: string; _reason: string; _status: string }
        Returns: undefined
      }
      election_withdraw_nomination: {
        Args: { _nomination: string }
        Returns: undefined
      }
      emergency_acknowledge: { Args: { _id: string }; Returns: undefined }
      emergency_broadcast_cancel: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      emergency_broadcast_send: {
        Args: {
          _audience: string
          _block_id: string
          _category_id: string
          _expires_minutes: number
          _message: string
          _request_id: string
          _sos_alert_id: string
          _title: string
        }
        Returns: string
      }
      emergency_set_category: {
        Args: { _active: boolean; _id: string; _label: string }
        Returns: string
      }
      end_resident_unit_relationship: {
        Args: {
          _flat_resident_id: string
          _moved_out_at?: string
          _reason?: string
          _society_id: string
        }
        Returns: undefined
      }
      end_temporary_occupant: { Args: { _id: string }; Returns: undefined }
      enroll_class: { Args: { _class_id: string }; Returns: string }
      ensure_maintenance_period: {
        Args: {
          _amount: number
          _due_date?: string
          _flat_id: string
          _period_start: string
        }
        Returns: string
      }
      ev_session_end: {
        Args: { _energy_kwh?: number; _note?: string; _session_id: string }
        Returns: undefined
      }
      ev_session_start: {
        Args: { _charger_id: string; _plate: string }
        Returns: string
      }
      event_counts: {
        Args: { _event_ids: string[] }
        Returns: {
          event_id: string
          going: number
          waitlist: number
        }[]
      }
      event_rsvp: {
        Args: { _event_id: string; _going: boolean }
        Returns: string
      }
      execute_finance_backfill: {
        Args: { _request_id: string; _society_id: string }
        Returns: Json
      }
      expire_stale_amenity_waitlist: { Args: never; Returns: number }
      expire_stale_tenancies: { Args: never; Returns: number }
      explorer_flat_dues_summary: {
        Args: { _society_id: string }
        Returns: {
          flat_id: string
          outstanding: number
          status_rank: number
        }[]
      }
      fail_maintenance_payment_order: {
        Args: { _code: string; _razorpay_order_id: string }
        Returns: undefined
      }
      fail_saas_subscription_order: {
        Args: { _failure_code: string; _request_record_id: string }
        Returns: undefined
      }
      fail_saas_subscription_refund: {
        Args: { _failure_code: string; _refund_record_id: string }
        Returns: undefined
      }
      fin_balance_sheet: {
        Args: { _as_of: string; _cmp_as_of?: string; _society_id: string }
        Returns: Json
      }
      fin_close_year: {
        Args: { _confirm: string; _fy_start: string; _society_id: string }
        Returns: Json
      }
      fin_compute_tax: {
        Args: {
          _amount: number
          _gst_rate: number
          _includes_gst: boolean
          _supply_type: string
          _tds_rate: number
        }
        Returns: Json
      }
      fin_create_account: {
        Args: {
          _account_type: string
          _code: string
          _name: string
          _society_id: string
        }
        Returns: string
      }
      fin_fy_start: { Args: { _d: string }; Returns: string }
      fin_income_expenditure: {
        Args: {
          _cmp_from?: string
          _cmp_to?: string
          _from: string
          _society_id: string
          _to: string
        }
        Returns: Json
      }
      fin_list_accounts: { Args: { _society_id: string }; Returns: Json }
      fin_list_manual_journals: {
        Args: {
          _limit: number
          _offset: number
          _society_id: string
          _status: string
        }
        Returns: Json
      }
      fin_reopen_year: {
        Args: { _fy_start: string; _reason: string; _society_id: string }
        Returns: Json
      }
      fin_save_manual_journal: {
        Args: {
          _description: string
          _journal_id: string
          _lines: Json
          _reference: string
          _request_id: string
          _society_id: string
          _transaction_date: string
        }
        Returns: string
      }
      fin_tally_export: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: Json
      }
      fin_tax_report: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: Json
      }
      fin_transition_manual_journal: {
        Args: {
          _action: string
          _journal_id: string
          _reason?: string
          _request_id?: string
          _reversal_date?: string
        }
        Returns: Json
      }
      fin_trial_balance: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: Json
      }
      fin_year_status: {
        Args: { _fy_start: string; _society_id: string }
        Returns: Json
      }
      finalize_bill_batch: {
        Args: {
          _cycle_config_id: string
          _prefix?: string
          _request_id: string
          _society_id: string
        }
        Returns: Json
      }
      finalize_maintenance_online_payment: {
        Args: {
          _amount_paise: number
          _currency: string
          _razorpay_order_id: string
          _razorpay_payment_id: string
        }
        Returns: Json
      }
      finalize_no_dues_issuance_internal: {
        Args: {
          _actor_id: string
          _certificate_number: string
          _request_id: string
          _storage_path: string
          _valid_until: string
          _verification_token_ciphertext: string
          _verification_token_hash: string
          _verification_token_iv: string
          _verification_token_key_version: number
        }
        Returns: {
          certificate_id: string
          certificate_number: string
          status: string
        }[]
      }
      finalize_saas_subscription_payment: {
        Args: {
          _amount_paise: number
          _currency: string
          _plan_id: string
          _provider_status: string
          _purchased_by: string
          _razorpay_order_id: string
          _razorpay_payment_id: string
          _society_id: string
        }
        Returns: Json
      }
      finalize_saas_subscription_refund: {
        Args: {
          _payment_id: string
          _provider_refund_id: string
          _reason: string
          _request_id: string
          _requested_by: string
        }
        Returns: Json
      }
      find_referrer_by_code: { Args: { _code: string }; Returns: string }
      find_society_by_code: {
        Args: { _code: string }
        Returns: {
          city: string
          id: string
          name: string
          state: string
        }[]
      }
      flat_outstanding: {
        Args: { _flat_id: string }
        Returns: {
          next_due: string
          overdue_count: number
          pending: number
        }[]
      }
      gate_assign_visitor_parking: {
        Args: { _slot_id: string; _visitor_id: string }
        Returns: undefined
      }
      gate_override: {
        Args: { _action: string; _id: string; _reason: string }
        Returns: undefined
      }
      gate_request_barrier_open: {
        Args: {
          _device_id: string
          _reason: string
          _request_id: string
          _visitor_id?: string
        }
        Returns: Json
      }
      gate_review_hardware_event: {
        Args: { _decision: string; _id: string }
        Returns: undefined
      }
      gate_safety_alerts: { Args: never; Returns: Json }
      gate_sos_open: {
        Args: never
        Returns: {
          created_at: string
          flat_label: string
          id: string
          note: string
          status: string
        }[]
      }
      gate_transition_allowed: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      gate_visitor_parking_list: {
        Args: never
        Returns: {
          id: string
          label: string
          occupied: boolean
          visitor_name: string
        }[]
      }
      generate_flat_bill: {
        Args: {
          _additional?: Json
          _due_date?: string
          _flat_id: string
          _notes?: string
          _period_ids: string[]
        }
        Returns: string
      }
      generate_referral_code: { Args: never; Returns: string }
      generate_society_code: { Args: never; Returns: string }
      get_ad_report: {
        Args: { _from: string; _to: string }
        Returns: {
          active: boolean
          ad_id: string
          clicks: number
          cta: number
          kind: string
          placement: string
          target_cities: string[]
          target_plans: string[]
          target_society_count: number
          title: string
          views: number
        }[]
      }
      get_admin_block_ids: { Args: { _user_id: string }; Returns: string[] }
      get_admin_society_ids: { Args: { _user_id: string }; Returns: string[] }
      get_amenity_fairness: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: {
          bookings: number
          cancellations: number
          flat_id: string
          flat_label: string
          no_shows: number
          peak_bookings: number
          waitlisted: number
        }[]
      }
      get_applicable_plans: {
        Args: { _total_units?: number }
        Returns: {
          enterprise: boolean
          features: Json
          is_recommended: boolean
          plan_id: string
          plan_name: string
          price_monthly_inr: number
          price_per_flat_inr: number
          tier: string
          trial_days: number
        }[]
      }
      get_auditor_pack: {
        Args: {
          _format?: string
          _from: string
          _society_id: string
          _to: string
        }
        Returns: Json
      }
      get_auditor_pack_extras: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: Json
      }
      get_bill_payment_summary: { Args: { _bill_id: string }; Returns: Json }
      get_bill_run_review: {
        Args: { _cycle_config_id: string; _society_id: string }
        Returns: Json
      }
      get_bill_upi_details: { Args: { _bill_id: string }; Returns: Json }
      get_budget_vs_actual: {
        Args: { _fy_start: number }
        Returns: {
          actual: number
          approved_amount: number
          budget_id: string
          category: string
          notes: string
          original_amount: number
          revision_count: number
          variance: number
        }[]
      }
      get_current_auth_context: {
        Args: never
        Returns: {
          primary_role: string
          profile: Json
          roles: Json
          society_id: string
        }[]
      }
      get_finance_overview: {
        Args: { _from: string; _society_id: string; _to: string }
        Returns: Json
      }
      get_flat_occupancy: { Args: { _flat_id: string }; Returns: Json }
      get_handover_summary: { Args: { _society_id: string }; Returns: Json }
      get_needs_attention: {
        Args: never
        Returns: {
          item_count: number
          key: string
          link: string
          priority: number
          reason: string
        }[]
      }
      get_outstanding_dues: {
        Args: { _society_id: string }
        Returns: {
          bill_id: string
          due_date: string
          flat_id: string
          flat_label: string
          outstanding: number
          period_label: string
          total_payable: number
          verified_paid: number
        }[]
      }
      get_partner_summary_for_current_user: {
        Args: never
        Returns: {
          available_balance: number
          pending_withdrawals: number
          referral_code: string
          referred_societies: number
          total_earnings: number
        }[]
      }
      get_payment_detail: { Args: { _payment_id: string }; Returns: Json }
      get_payment_proof_path: { Args: { _payment_id: string }; Returns: string }
      get_payment_receipt_lifecycle: {
        Args: { _payment_id: string }
        Returns: Json
      }
      get_procurement_report: {
        Args: { _fy_start: number }
        Returns: {
          approved_amount: number
          category: string
          created_at: string
          decided_at: string
          expense_amount: number
          expense_id: string
          expense_status: string
          id: string
          invoice_amount: number
          invoice_ref: string
          payment_ref: string
          request_no: number
          status: string
          title: string
          vendor_name: string
        }[]
      }
      get_public_pricing_settings: {
        Args: never
        Returns: {
          active_gateway: string
          enterprise_threshold_units: number
          trial_days: number
        }[]
      }
      get_razorpay_public_config: {
        Args: never
        Returns: {
          configured: boolean
          key_id: string
        }[]
      }
      get_receivables_ageing: {
        Args: { _as_of?: string; _society_id: string }
        Returns: {
          amount: number
          bill_count: number
          bucket: string
        }[]
      }
      get_resident_directory_overview: {
        Args: { _society_id: string }
        Returns: {
          active_residents: number
          active_vehicles: number
          occupied_units: number
          owners: number
          tenants: number
          total_residents: number
          vacant_units: number
        }[]
      }
      get_resident_finance_transparency: {
        Args: {
          _from: string
          _limit?: number
          _society_id: string
          _to: string
        }
        Returns: Json
      }
      get_resident_payments_v1: {
        Args: { _limit: number; _offset: number }
        Returns: Json[]
      }
      get_resident_private_detail: {
        Args: { _society_id: string; _user_id: string }
        Returns: Json
      }
      get_society_access_status: {
        Args: { _society_id: string }
        Returns: {
          plan_expires_at: string
          plan_id: string
          status: string
          trial_consumed_at: string
          trial_ends_at: string
        }[]
      }
      get_society_automations: { Args: { _society_id: string }; Returns: Json }
      get_society_branding: { Args: { _society_id: string }; Returns: Json }
      get_society_business_profile: {
        Args: { _society_id: string }
        Returns: {
          business_address: string
          business_city: string
          business_gstin: string
          business_pan: string
          business_pincode: string
          business_state: string
          id: string
          legal_business_name: string
          name: string
          payout_bank_last4: string
          payout_holder_name: string
          payout_status: string
          razorpay_account_id: string
        }[]
      }
      get_society_export_section: {
        Args: { _offset?: number; _section: string; _society_id: string }
        Returns: Json
      }
      get_society_income_report: {
        Args: {
          _category_id?: string
          _from_date: string
          _payer_kind?: string
          _payment_method?: string
          _reconciliation_status?: string
          _society_id: string
          _to_date: string
          _verification_status?: string
        }
        Returns: Json
      }
      get_society_invite_code: {
        Args: { _society_id: string }
        Returns: string
      }
      get_society_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          avatar_url: string
          badge_count: number
          display_name: string
          is_me: boolean
          rank: number
          total_points: number
        }[]
      }
      get_society_payout_admin: {
        Args: { _society_id: string }
        Returns: {
          has_linked_account: boolean
          payout_bank_last4: string
          payout_holder_name: string
          payout_status: string
        }[]
      }
      get_society_privacy: {
        Args: { _society_id: string }
        Returns: {
          privacy_contacts: string
          privacy_directory: string
          privacy_documents: string
          privacy_finances: string
          privacy_vehicles: string
        }[]
      }
      get_society_register: {
        Args: { _offset?: number; _search?: string; _section: string }
        Returns: Json
      }
      get_society_structure_overview: {
        Args: { _society_id: string }
        Returns: Json
      }
      get_survey_results: { Args: { _poll_id: string }; Returns: Json }
      get_user_society_id: { Args: { _user_id: string }; Returns: string }
      global_search: {
        Args: { _limit?: number; _q: string }
        Returns: {
          id: string
          kind: string
          link: string
          subtitle: string
          title: string
        }[]
      }
      group_counts: {
        Args: { _ids: string[] }
        Returns: {
          group_id: string
          members: number
          pending: number
        }[]
      }
      group_membership: {
        Args: { _group_id: string; _join: boolean }
        Returns: string
      }
      guard_checkin_by_code: {
        Args: { _code: string; _society_id: string }
        Returns: string
      }
      guard_checkin_code: {
        Args: { _code: string }
        Returns: {
          flat_label: string
          id: string
          visitor_name: string
        }[]
      }
      guard_checkin_recurring: { Args: { _pass_id: string }; Returns: string }
      guard_end_session: { Args: never; Returns: undefined }
      guard_gate_list: {
        Args: { _q?: string; _scope?: string }
        Returns: {
          category: string
          created_at: string
          entry_at: string
          exit_at: string
          expected_at: string
          flat_label: string
          id: string
          phone_last4: string
          pre_approved: boolean
          purpose: string
          status: string
          valid_until: string
          vehicle_number: string
          visitor_name: string
        }[]
      }
      guard_log_walkin: {
        Args: {
          _category: string
          _flat_label: string
          _name: string
          _phone: string
          _purpose: string
          _vehicle: string
        }
        Returns: string
      }
      guard_mark_material_pass: {
        Args: { _action: string; _pass_id: string }
        Returns: undefined
      }
      guard_offline_replay: {
        Args: { _kind: string; _op_id: string; _payload: Json }
        Returns: Json
      }
      guard_patrol_checkpoint: {
        Args: {
          _checkpoint_id: string
          _code?: string
          _incident_severity?: string
          _note?: string
          _round_id: string
        }
        Returns: Json
      }
      guard_patrol_finish: {
        Args: { _note?: string; _round_id: string }
        Returns: string
      }
      guard_patrol_list: { Args: never; Returns: Json }
      guard_patrol_start: { Args: { _round_id: string }; Returns: undefined }
      guard_recurring_list: {
        Args: { _q?: string }
        Returns: {
          category: string
          end_time: string
          flat_label: string
          id: string
          inside: boolean
          phone_last4: string
          start_time: string
          valid_now: boolean
          visitor_name: string
        }[]
      }
      guard_redeem_entry_token: {
        Args: { _device?: string; _token: string }
        Returns: Json
      }
      guard_session_status: { Args: never; Returns: Json }
      guard_start_session: { Args: { _device?: string }; Returns: string }
      guard_verify_vehicle: {
        Args: { _plate: string }
        Returns: {
          color: string
          flat_label: string
          make_model: string
          parking_label: string
          plate_number: string
          vehicle_type: string
        }[]
      }
      guard_visitor_action: {
        Args: { _action: string; _id: string }
        Returns: undefined
      }
      guard_visitor_flags: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          needs_committee: boolean
          overridden: boolean
          parking_label: string
          restricted: boolean
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      helpdesk_add_comment: {
        Args: { _body: string; _ticket: string }
        Returns: undefined
      }
      helpdesk_admin_queue: {
        Args: { _limit?: number; _status?: string }
        Returns: {
          approval_status: string
          assigned_to: string
          assignee_name: string
          category: string
          created_at: string
          description: string
          flat_label: string
          id: string
          last_activity_at: string
          priority: string
          requester_name: string
          requires_approval: boolean
          status: string
          subject: string
          ticket_no: number
        }[]
      }
      helpdesk_admin_queue_v2: {
        Args: { _limit?: number }
        Returns: {
          approval_status: string
          asset_id: string
          asset_name: string
          assigned_to: string
          assignee_name: string
          category: string
          created_at: string
          description: string
          escalation_level: number
          escalation_reason: string
          flat_label: string
          hold_reason: string
          id: string
          last_activity_at: string
          parent_ticket_id: string
          priority: string
          rating: number
          reopened_count: number
          requester_name: string
          requires_approval: boolean
          sla_due_at: string
          staff_id: string
          staff_name: string
          status: string
          subject: string
          ticket_no: number
          vendor_id: string
          vendor_name: string
        }[]
      }
      helpdesk_admin_update: {
        Args: {
          _assign?: string
          _note?: string
          _status?: string
          _ticket: string
          _unassign?: boolean
        }
        Returns: undefined
      }
      helpdesk_assign_work: {
        Args: {
          _asset: string
          _staff: string
          _ticket: string
          _vendor: string
        }
        Returns: undefined
      }
      helpdesk_assignees: {
        Args: never
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      helpdesk_create_ticket: {
        Args: {
          _category: string
          _description: string
          _priority: string
          _subject: string
        }
        Returns: string
      }
      helpdesk_decide_approval: {
        Args: { _approve: boolean; _reason?: string; _ticket: string }
        Returns: undefined
      }
      helpdesk_escalate: {
        Args: { _reason: string; _ticket: string }
        Returns: undefined
      }
      helpdesk_rate: {
        Args: { _comment: string; _rating: number; _ticket: string }
        Returns: undefined
      }
      helpdesk_record_attachment: {
        Args: { _mime: string; _path: string; _size: number; _ticket: string }
        Returns: string
      }
      helpdesk_reopen: {
        Args: { _note: string; _ticket: string }
        Returns: string
      }
      helpdesk_report: {
        Args: {
          _asset?: string
          _category?: string
          _flag?: string
          _from?: string
          _priority?: string
          _staff?: string
          _status?: string
          _to?: string
          _vendor?: string
        }
        Returns: Json
      }
      helpdesk_report_rows: {
        Args: {
          _asset?: string
          _category?: string
          _flag?: string
          _from?: string
          _priority?: string
          _staff?: string
          _status?: string
          _to?: string
          _vendor?: string
        }
        Returns: {
          asset_name: string
          category: string
          created_at: string
          escalation_level: number
          overdue: boolean
          priority: string
          rating: number
          reopened_count: number
          resolved_at: string
          sla_due_at: string
          staff_name: string
          status: string
          subject: string
          ticket_no: number
          vendor_name: string
        }[]
      }
      helpdesk_resident_action: {
        Args: { _action: string; _note?: string; _ticket: string }
        Returns: undefined
      }
      helpdesk_ticket_access: {
        Args: { _ticket: string }
        Returns: {
          can_upload: boolean
          can_view: boolean
          society_id: string
        }[]
      }
      helpdesk_ticket_timeline: {
        Args: { _ticket: string }
        Returns: {
          actor_kind: string
          actor_name: string
          body: string
          created_at: string
          from_status: string
          id: string
          kind: string
          to_status: string
        }[]
      }
      ignore_bank_line: {
        Args: { _line_id: string; _reason: string }
        Returns: Json
      }
      import_bank_statement: {
        Args: {
          _file_name: string
          _file_sha256: string
          _rows: Json
          _society_id: string
        }
        Returns: Json
      }
      import_historical_payments: {
        Args: {
          _dry_run: boolean
          _request_id: string
          _rows: Json
          _society_id: string
          _source_ref: string
        }
        Returns: Json
      }
      import_opening_balances: {
        Args: {
          _request_id: string
          _rows: Json
          _society_id: string
          _source_ref: string
        }
        Returns: Json
      }
      import_opening_balances_v2: {
        Args: {
          _dry_run: boolean
          _request_id: string
          _rows: Json
          _society_id: string
          _source_ref: string
        }
        Returns: Json
      }
      incident_create: {
        Args: {
          _kind: string
          _note: string
          _severity: string
          _visitor_id: string
        }
        Returns: string
      }
      incident_resolve: {
        Args: { _id: string; _note: string }
        Returns: undefined
      }
      invoice_ai_confirm: {
        Args: {
          _amount: number
          _category: string
          _description: string
          _expense_date: string
          _id: string
          _invoice_number: string
          _payment_method: string
          _procurement_request_id: string
          _request_id: string
          _vendor_id: string
        }
        Returns: Json
      }
      invoice_ai_record_result: {
        Args: {
          _error: string
          _extracted: Json
          _id: string
          _invoice_number: string
          _notes: string[]
          _status: string
          _vendor_gstin: string
        }
        Returns: undefined
      }
      invoice_ai_register: {
        Args: {
          _mime: string
          _name: string
          _size: number
          _society_id: string
        }
        Returns: Json
      }
      invoice_ai_reject: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      is_active_society_plan: {
        Args: { _society_id: string }
        Returns: boolean
      }
      is_block_admin: {
        Args: { _block_id: string; _user_id: string }
        Returns: boolean
      }
      is_block_admin_for_flat_internal: {
        Args: { _actor_id: string; _flat_id: string }
        Returns: boolean
      }
      is_known_capability: { Args: { _cap: string }; Returns: boolean }
      is_login_account_locked: {
        Args: {
          _max_failures?: number
          _subject: string
          _window_seconds?: number
        }
        Returns: {
          locked: boolean
          retry_after_seconds: number
        }[]
      }
      is_non_member_income_enabled_internal: {
        Args: { _society_id: string }
        Returns: boolean
      }
      is_razorpay_live: { Args: never; Returns: boolean }
      is_society_admin_for:
        | { Args: { _society_id: string }; Returns: boolean }
        | { Args: { _society_id: string; _user_id: string }; Returns: boolean }
      is_society_admin_for_internal: {
        Args: { _actor_id: string; _society_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin_internal: { Args: { _actor_id: string }; Returns: boolean }
      join_society_with_code: { Args: { _code: string }; Returns: string }
      knowledge_begin_document: {
        Args: {
          _audience: string
          _ext: string
          _file_name: string
          _mime: string
          _replace_id?: string
          _size: number
          _title: string
        }
        Returns: Json
      }
      knowledge_delete: { Args: { _id: string }; Returns: Json }
      knowledge_document_path: { Args: { _id: string }; Returns: string }
      knowledge_finish_document: {
        Args: {
          _id: string
          _reason: string
          _status: string
          _text: string
          _version: number
        }
        Returns: Json
      }
      knowledge_lease_candidates: {
        Args: never
        Returns: {
          block_name: string
          flat_number: string
          flat_resident_id: string
          is_current: boolean
          lease_ends_on: string
          lease_starts_on: string
          relationship: string
          resident_name: string
        }[]
      }
      knowledge_link_lease: {
        Args: { _flat_resident_id: string; _id: string }
        Returns: undefined
      }
      knowledge_set_archived: {
        Args: { _archived: boolean; _id: string }
        Returns: Json
      }
      knowledge_set_category: {
        Args: { _category: string; _id: string }
        Returns: undefined
      }
      knowledge_upsert_faq: {
        Args: {
          _answer: string
          _audience: string
          _id: string
          _question: string
        }
        Returns: Json
      }
      knowledge_version_path: { Args: { _version_id: string }; Returns: string }
      leave_class: { Args: { _class_id: string }; Returns: undefined }
      list_bank_line_candidates: { Args: { _line_id: string }; Returns: Json }
      list_bank_statement_lines: {
        Args: {
          _limit?: number
          _offset?: number
          _society_id: string
          _status?: string
        }
        Returns: Json
      }
      list_depreciation_assets: {
        Args: { _society_id: string }
        Returns: {
          asset_id: string
          category: string
          name: string
          purchase_date: string
          status: string
        }[]
      }
      list_discovery_items: {
        Args: { _kind?: string; _placement?: string }
        Returns: {
          business_name: string
          category_id: string
          cta_label: string
          description: string
          id: string
          image_path: string
          kind: string
          link_url: string
          phone: string
          placement: string
          sort_order: number
          sponsored: boolean
          title: string
          whatsapp: string
        }[]
      }
      list_expiring_tenancies: {
        Args: { _society_id: string; _within_days?: number }
        Returns: {
          days_remaining: number
          flat_id: string
          flat_number: string
          flat_resident_id: string
          lease_ends_on: string
          resident_name: string
          user_id: string
        }[]
      }
      list_finance_book: {
        Args: {
          _book: string
          _from: string
          _limit?: number
          _offset?: number
          _society_id: string
          _to: string
        }
        Returns: {
          credit: number
          debit: number
          description: string
          entry_id: string
          reference: string
          running_balance: number
          source_type: string
          status: string
          transaction_date: string
        }[]
      }
      list_finance_import_batches: {
        Args: { _society_id: string }
        Returns: Json
      }
      list_finance_workspace: {
        Args: {
          _limit?: number
          _offset?: number
          _resource: string
          _society_id: string
        }
        Returns: Json
      }
      list_market_listings: {
        Args: { _category_id?: string }
        Returns: {
          category_id: string
          contact_link: string
          contact_method: string
          contact_phone: string
          created_at: string
          description: string
          expires_at: string
          id: string
          image_path: string
          is_mine: boolean
          kind: string
          owner_name: string
          price_inr: number
          title: string
        }[]
      }
      list_my_emergency_broadcasts: {
        Args: never
        Returns: {
          acknowledged_at: string
          cancel_reason: string
          cancelled_at: string
          category_label: string
          created_at: string
          expires_at: string
          id: string
          message: string
          state: string
          title: string
        }[]
      }
      list_my_homes: {
        Args: never
        Returns: {
          block_name: string
          flat_id: string
          flat_number: string
          is_active_home: boolean
          relationship: string
          society_id: string
          society_name: string
        }[]
      }
      list_my_lease_documents: {
        Args: never
        Returns: {
          expires_on: string
          file_name: string
          flat_number: string
          id: string
          title: string
          updated_at: string
          version: number
        }[]
      }
      list_my_role_invitations: {
        Args: never
        Returns: {
          expires_at: string
          id: string
          job_type: string
          permissions: string[]
          role: string
          society_name: string
        }[]
      }
      list_my_societies: {
        Args: never
        Returns: {
          is_current: boolean
          roles: string[]
          society_id: string
          society_name: string
          tenancy_ends_on: string
        }[]
      }
      list_non_member_payers_page: {
        Args: {
          _active?: string
          _limit?: number
          _offset?: number
          _payer_type?: string
          _search?: string
          _society_id: string
        }
        Returns: Json
      }
      list_payment_receipts_v1: {
        Args: { _limit?: number; _society_id: string }
        Returns: Json[]
      }
      list_pending_join_requests: {
        Args: { _society_id: string }
        Returns: {
          created_at: string
          flat_number_input: string
          full_name: string
          id: string
          mobile: string
          owner_or_tenant: string
          requester_email: string
          user_id: string
        }[]
      }
      list_role_block_scopes: {
        Args: { _role_id: string }
        Returns: {
          block_id: string
          block_name: string
        }[]
      }
      list_society_flats_public: {
        Args: { _society_id: string }
        Returns: {
          block_id: string
          block_name: string
          flat_id: string
          flat_number: string
          floor: number
          is_occupied: boolean
        }[]
      }
      list_society_payments_v1: {
        Args: {
          _limit: number
          _offset: number
          _society_id: string
          _status: string
        }
        Returns: Json[]
      }
      list_society_residents_page: {
        Args: {
          _active_only?: boolean
          _flat_id?: string
          _limit?: number
          _offset?: number
          _relationship?: string
          _search?: string
          _society_id: string
        }
        Returns: {
          avatar_url: string
          block_name: string
          flat_id: string
          flat_number: string
          full_name: string
          is_active: boolean
          is_primary: boolean
          moved_in_at: string
          relationship: string
          structure_mode: string
          total_count: number
          user_id: string
        }[]
      }
      list_society_residents_safe_page: {
        Args: {
          _limit?: number
          _offset?: number
          _search?: string
          _society_id: string
        }
        Returns: {
          block_name: string
          flat_number: string
          full_name: string
          total_count: number
          user_id: string
        }[]
      }
      list_society_team_members: {
        Args: { _include_inactive?: boolean; _society_id: string }
        Returns: {
          assigned_by: string
          block_id: string
          block_name: string
          created_at: string
          full_name: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          role_id: string
          updated_at: string
          user_id: string
        }[]
      }
      list_society_team_members_v2: {
        Args: { _include_inactive?: boolean; _society_id: string }
        Returns: {
          assigned_by: string
          block_ids: string[]
          block_names: string[]
          created_at: string
          full_name: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          role_id: string
          updated_at: string
          user_id: string
        }[]
      }
      list_society_units_page: {
        Args: {
          _active?: boolean
          _block_id?: string
          _floor?: number
          _limit?: number
          _offset?: number
          _search?: string
          _society_id: string
          _unit_type?: string
        }
        Returns: Json
      }
      list_tenancies: {
        Args: { _filter?: string; _society_id: string }
        Returns: {
          days_remaining: number
          flat_id: string
          flat_number: string
          flat_resident_id: string
          lease_ends_on: string
          lease_starts_on: string
          moved_in_at: string
          moved_out_at: string
          notice_given_on: string
          relationship: string
          resident_name: string
          state: string
          user_id: string
        }[]
      }
      log_register_export: {
        Args: { _rows: number; _section: string }
        Returns: undefined
      }
      mark_aadhaar_verified: { Args: { _last4: string }; Returns: undefined }
      mark_visitor_overstays: { Args: never; Returns: number }
      market_contact: {
        Args: { _id: string; _message: string }
        Returns: undefined
      }
      market_moderate: {
        Args: { _action: string; _id: string; _reason: string }
        Returns: undefined
      }
      market_report: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      market_save_listing: {
        Args: {
          _category_id: string
          _contact_link: string
          _contact_method: string
          _contact_phone: string
          _description: string
          _expires_days: number
          _id: string
          _kind: string
          _price_inr: number
          _title: string
        }
        Returns: string
      }
      market_set_category: {
        Args: { _active: boolean; _id: string; _label: string }
        Returns: string
      }
      market_set_image: {
        Args: { _id: string; _path: string }
        Returns: undefined
      }
      market_set_status: {
        Args: { _id: string; _status: string }
        Returns: undefined
      }
      meeting_add_action: {
        Args: { _due: string; _meeting: string; _owner: string; _title: string }
        Returns: string
      }
      meeting_add_minutes_correction: {
        Args: { _body: string; _id: string; _reason: string }
        Returns: string
      }
      meeting_add_resolution: {
        Args: {
          _meeting: string
          _outcome: string
          _poll: string
          _text: string
        }
        Returns: string
      }
      meeting_link_document: {
        Args: { _linked: boolean; _meeting: string; _source: string }
        Returns: undefined
      }
      meeting_member_roster: {
        Args: { _id: string }
        Returns: {
          full_name: string
          homes: string
          present: boolean
          rsvp: string
          user_id: string
        }[]
      }
      meeting_record_attendance: {
        Args: { _id: string; _present: boolean; _user: string }
        Returns: undefined
      }
      meeting_rsvp: {
        Args: { _id: string; _response: string }
        Returns: undefined
      }
      meeting_save: {
        Args: {
          _agenda: string
          _audience: string
          _ends_at: string
          _id: string
          _link: string
          _location: string
          _starts_at: string
          _title: string
        }
        Returns: string
      }
      meeting_save_minutes: {
        Args: { _id: string; _minutes: string }
        Returns: undefined
      }
      meeting_set_action_status: {
        Args: { _id: string; _status: string }
        Returns: undefined
      }
      meeting_set_status: {
        Args: { _id: string; _reason: string; _status: string }
        Returns: undefined
      }
      migration_begin_upload: {
        Args: {
          _actor: string
          _declared_size: number
          _filename: string
          _society_id: string
          _source_type: string
          _structure_mode: string
        }
        Returns: {
          job_id: string
          storage_path: string
        }[]
      }
      migration_create_job: {
        Args: {
          _declared_size: number
          _filename: string
          _society_id: string
          _source_type: string
          _storage_path: string
          _structure_mode: string
        }
        Returns: string
      }
      migration_finalize_upload: {
        Args: {
          _actual_size: number
          _checksum: string
          _job_id: string
          _row_count: number
        }
        Returns: Json
      }
      migration_hold_problem_rows: { Args: { _job_id: string }; Returns: Json }
      migration_replace_staging: {
        Args: { _job_id: string; _rows: Json; _totals: Json }
        Returns: Json
      }
      migration_rollback_job: {
        Args: { _job_id: string; _reason: string }
        Returns: Json
      }
      migration_set_retry_of: {
        Args: { _job_id: string; _retry_of: string }
        Returns: Json
      }
      migration_setup_checklist: {
        Args: { _society_id: string }
        Returns: Json
      }
      migration_upload_path_ok: { Args: { _name: string }; Returns: boolean }
      my_household_history: {
        Args: never
        Returns: {
          ended_reason: string
          flat_number: string
          full_name: string
          is_you: boolean
          moved_in_at: string
          moved_out_at: string
          relationship: string
        }[]
      }
      my_lease_document_path: { Args: { _id: string }; Returns: string }
      my_role_access: { Args: never; Returns: Json }
      next_no_dues_cert_number_internal: {
        Args: { _actor_id: string; _society_id: string }
        Returns: string
      }
      notice_acknowledge: { Args: { _id: string }; Returns: undefined }
      notice_archive: { Args: { _id: string }; Returns: undefined }
      notice_delivery_stats: {
        Args: { _ids: string[] }
        Returns: {
          acknowledged: number
          audience: number
          notice_id: string
          notified: number
          opened: number
        }[]
      }
      notice_read_counts: {
        Args: never
        Returns: {
          notice_id: string
          reads: number
        }[]
      }
      notice_save: {
        Args: {
          _audience: string
          _block_id: string
          _body: string
          _category: string
          _id: string
          _publish: boolean
          _publish_at: string
          _title: string
        }
        Returns: string
      }
      notice_set_controls: {
        Args: {
          _expires_at: string
          _id: string
          _priority: string
          _requires_ack: boolean
        }
        Returns: undefined
      }
      ops_daily_reminders: { Args: never; Returns: undefined }
      parking_evidence_target: { Args: { _violation: string }; Returns: string }
      parking_record_evidence: {
        Args: {
          _mime: string
          _path: string
          _size: number
          _violation: string
        }
        Returns: string
      }
      parking_remove_evidence: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      parking_sweep: { Args: { _sid?: string }; Returns: number }
      parking_violation_report: {
        Args: {
          _description: string
          _location: string
          _occurred_at?: string
          _plate: string
          _slot_id: string
          _type: string
        }
        Returns: string
      }
      patrol_sweep: { Args: { _sid: string }; Returns: undefined }
      poll_cast_vote: {
        Args: { _option: string; _poll: string }
        Returns: undefined
      }
      poll_results: {
        Args: { _poll_ids: string[] }
        Returns: {
          option_id: string
          poll_id: string
          votes: number
        }[]
      }
      preview_bill_batch: {
        Args: {
          _cycle_config_id: string
          _limit?: number
          _offset?: number
          _society_id: string
        }
        Returns: Json
      }
      preview_billing_template: {
        Args: {
          _limit: number
          _offset: number
          _society_id: string
          _template_id: string
        }
        Returns: Json
      }
      preview_finance_backfill: { Args: { _society_id: string }; Returns: Json }
      privacy_personal_export: { Args: never; Returns: Json }
      privacy_request_create: {
        Args: { _details: string; _kind: string }
        Returns: string
      }
      privacy_request_review: {
        Args: { _id: string; _outcome: string; _status: string }
        Returns: undefined
      }
      privacy_request_withdraw: { Args: { _id: string }; Returns: undefined }
      proc_add_quotation: {
        Args: {
          _amount: number
          _notes: string
          _quote_ref: string
          _request: string
          _valid_until: string
          _vendor: string
        }
        Returns: string
      }
      proc_attachment_target: {
        Args: { _kind: string; _quotation: string; _request: string }
        Returns: string
      }
      proc_cancel: {
        Args: { _reason: string; _request: string }
        Returns: undefined
      }
      proc_create: {
        Args: {
          _category: string
          _description: string
          _estimated: number
          _fy_start: number
          _needed_by: string
          _title: string
        }
        Returns: string
      }
      proc_decide: {
        Args: { _approve: boolean; _note: string; _request: string }
        Returns: undefined
      }
      proc_link_expense: {
        Args: { _expense: string; _request: string }
        Returns: undefined
      }
      proc_mark_ordered: {
        Args: { _order_ref: string; _request: string }
        Returns: undefined
      }
      proc_record_attachment: {
        Args: {
          _kind: string
          _mime: string
          _name: string
          _path: string
          _quotation: string
          _request: string
          _size: number
        }
        Returns: string
      }
      proc_record_invoice: {
        Args: {
          _amount: number
          _invoice_date: string
          _invoice_ref: string
          _request: string
        }
        Returns: undefined
      }
      proc_record_payment_ref: {
        Args: { _payment_ref: string; _request: string }
        Returns: undefined
      }
      proc_remove_attachment: {
        Args: { _attachment: string; _reason: string }
        Returns: undefined
      }
      proc_request_approval: {
        Args: { _quotation: string; _request: string }
        Returns: undefined
      }
      proc_submit: { Args: { _request: string }; Returns: undefined }
      procurement_transition_allowed: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      publish_due_notices: { Args: never; Returns: number }
      recheck_no_dues_request_internal: {
        Args: { _actor_id: string; _request_id: string }
        Returns: {
          eligibility: Json
          new_status: string
        }[]
      }
      record_ad_event: {
        Args: { _ad_id: string; _event: string; _placement: string }
        Returns: boolean
      }
      record_auditor_pack_failure: {
        Args: {
          _format: string
          _from: string
          _reason: string
          _society_id: string
          _to: string
        }
        Returns: undefined
      }
      record_saas_subscription_refund_submission: {
        Args: { _provider_refund_id: string; _refund_record_id: string }
        Returns: undefined
      }
      refresh_bank_statement_suggestions: {
        Args: { _society_id: string }
        Returns: Json
      }
      refresh_society_payout_status_internal: {
        Args: { _actor_id: string; _payout_status: string; _society_id: string }
        Returns: Json
      }
      regenerate_society_invite_code: {
        Args: { _society_id: string }
        Returns: string
      }
      reject_offline_payment: {
        Args: { _payment_id: string; _reason: string }
        Returns: undefined
      }
      request_bill_run_approval: {
        Args: { _cycle_config_id: string; _society_id: string }
        Returns: Json
      }
      request_join_flat: {
        Args: { _flat_id: string; _relationship: string }
        Returns: string
      }
      request_material_pass: {
        Args: {
          _contractor: string
          _description: string
          _flat_id: string
          _from: string
          _kind: string
          _lift: boolean
          _until: string
        }
        Returns: string
      }
      reset_own_kyc: { Args: never; Returns: undefined }
      resident_add_pet: {
        Args: {
          _breed: string
          _name: string
          _species: string
          _vaccinated_until: string
        }
        Returns: string
      }
      resident_remove_pet: { Args: { _id: string }; Returns: undefined }
      resident_set_recurring_pass_status: {
        Args: { _id: string; _status: string }
        Returns: undefined
      }
      resident_set_safety_contact: {
        Args: {
          _active?: boolean
          _id: string
          _name: string
          _phone: string
          _relation: string
        }
        Returns: string
      }
      resident_upsert_recurring_pass: {
        Args: {
          _category: string
          _days: number[]
          _end: string
          _id: string
          _name: string
          _phone: string
          _start: string
          _until: string
        }
        Returns: string
      }
      resolve_financial_visibility: {
        Args: { _society_id: string }
        Returns: string
      }
      resolve_privacy_access: {
        Args: {
          _resource: string
          _society_id: string
          _subject_user_id?: string
        }
        Returns: boolean
      }
      respond_join_request: {
        Args: { _approve: boolean; _reason?: string; _request_id: string }
        Returns: undefined
      }
      respond_role_invitation: {
        Args: { _accept: boolean; _id: string }
        Returns: string
      }
      reupload_own_kyc: {
        Args: { _aadhaar_last4: string; _aadhaar_url: string }
        Returns: undefined
      }
      revalidate_amenity_bookings: { Args: never; Returns: number }
      reverse_finance_expense: {
        Args: { _expense_id: string; _reason: string }
        Returns: Json
      }
      reverse_offline_payment: {
        Args: { _payment_id: string; _reason: string }
        Returns: undefined
      }
      review_historical_payment: {
        Args: { _confirm: boolean; _id: string; _note: string }
        Returns: Json
      }
      review_opening_balance: {
        Args: { _confirm: boolean; _id: string; _note: string }
        Returns: Json
      }
      revoke_no_dues_certificate_internal: {
        Args: { _actor_id: string; _certificate_id: string; _reason: string }
        Returns: undefined
      }
      rollback_historical_payment_batch: {
        Args: { _reason: string; _request_id: string; _society_id: string }
        Returns: Json
      }
      rollback_opening_balance_batch: {
        Args: { _reason: string; _request_id: string; _society_id: string }
        Returns: Json
      }
      run_logged_db_job: { Args: { _job: string }; Returns: string }
      saas_subscription_quote: {
        Args: { _plan_id: string; _society_id: string }
        Returns: Json
      }
      safety_alert_raise: {
        Args: {
          _kind: string
          _last_seen: string
          _note: string
          _subject: string
        }
        Returns: string
      }
      safety_alert_update: {
        Args: { _action: string; _id: string; _note?: string }
        Returns: undefined
      }
      save_billing_template: {
        Args: {
          _billing_frequency: string
          _effective_from: string
          _effective_to: string
          _id: string
          _name: string
          _society_id: string
          _status: string
        }
        Returns: string
      }
      save_billing_template_line: {
        Args: {
          _active: boolean
          _amount: number
          _area_unit: string
          _charge_head_id: string
          _id: string
          _rate_per_area: number
          _required_approval: boolean
          _rule_type: string
          _society_id: string
          _sort_order: number
          _template_id: string
          _unit_type: string
        }
        Returns: string
      }
      save_charge_head: {
        Args: {
          _active: boolean
          _category: string
          _default_amount: number
          _description: string
          _id: string
          _name: string
          _society_id: string
        }
        Returns: string
      }
      save_wizard_draft: {
        Args: { _society_id: string; _state: Json }
        Returns: undefined
      }
      scheduler_prune_runs: { Args: never; Returns: number }
      scheduler_run_begin: {
        Args: { _job: string; _run_key: string }
        Returns: string
      }
      scheduler_run_finish: {
        Args: {
          _error: string
          _failed: number
          _id: string
          _processed: number
          _status: string
        }
        Returns: undefined
      }
      search_societies_by_name: {
        Args: { _q: string }
        Returns: {
          city: string
          id: string
          name: string
          state: string
        }[]
      }
      search_societies_public: {
        Args: { _q: string }
        Returns: {
          city: string
          id: string
          logo_url: string
          name: string
          state: string
        }[]
      }
      search_society_open_bills: {
        Args: {
          _limit?: number
          _offset?: number
          _query?: string
          _society_id: string
        }
        Returns: {
          available_to_submit: number
          bill_id: string
          bill_number: string
          block_name: string
          due_date: string
          flat_id: string
          flat_label: string
          pending_amount: number
          period_label: string
          remaining_verified_balance: number
          society_id: string
          status: string
          total_payable: number
          verified_amount: number
        }[]
      }
      seed_finance_accounts: { Args: { _society_id: string }; Returns: Json }
      send_class_reminders: { Args: never; Returns: number }
      send_document_expiry_reminders: {
        Args: { _today?: string }
        Returns: number
      }
      send_meeting_reminders: { Args: never; Returns: number }
      send_tenancy_renewal_reminders: { Args: never; Returns: number }
      set_society_block_active: {
        Args: { _active: boolean; _block_id: string }
        Returns: Json
      }
      set_society_invite_code_custom: {
        Args: { _code: string; _society_id: string }
        Returns: string
      }
      set_society_invite_code_enabled: {
        Args: { _enabled: boolean; _society_id: string }
        Returns: boolean
      }
      set_society_unit_active: {
        Args: { _active: boolean; _unit_id: string }
        Returns: Json
      }
      smart_qr_create: {
        Args: {
          _accepts_cash: boolean
          _account_number: string
          _bank_name: string
          _category_id: string
          _expires_at: string
          _fixed_amount: number
          _ifsc: string
          _instructions: string
          _payee_name: string
          _purpose: string
          _title: string
        }
        Returns: Json
      }
      smart_qr_public_submit: {
        Args: {
          _amount: number
          _idempotency_key: string
          _note: string
          _paid_on: string
          _payer_name: string
          _payer_phone: string
          _payment_method: string
          _reference_number: string
          _token: string
        }
        Returns: Json
      }
      smart_qr_public_view: { Args: { _token: string }; Returns: Json }
      smart_qr_review_submission: {
        Args: { _action: string; _reason?: string; _submission_id: string }
        Returns: Json
      }
      smart_qr_set_active: {
        Args: { _active: boolean; _qr_id: string }
        Returns: Json
      }
      society_has_access: { Args: { _society_id: string }; Returns: boolean }
      society_maintenance_summary: {
        Args: { _society_id: string }
        Returns: {
          advance_amount: number
          advance_periods: number
          collection_percent: number
          outstanding_amount: number
          overdue_periods: number
          paid_periods: number
          pending_periods: number
          total_houses: number
        }[]
      }
      society_payout_active: { Args: { _society_id: string }; Returns: boolean }
      sos_raise: { Args: { _note: string }; Returns: string }
      sos_update: { Args: { _action: string; _id: string }; Returns: undefined }
      staff_document_path: { Args: { _id: string }; Returns: string }
      staff_gate_inside: {
        Args: never
        Returns: {
          category: string
          entry_at: string
          flat_number: string
          visitor: string
        }[]
      }
      staff_list_assets: {
        Args: never
        Returns: {
          amc_until: string
          category: string
          id: string
          last_service: string
          location: string
          name: string
          status: string
          warranty_until: string
        }[]
      }
      staff_list_documents: {
        Args: never
        Returns: {
          category: string
          file_name: string
          id: string
          title: string
          updated_at: string
        }[]
      }
      staff_list_inventory: {
        Args: never
        Returns: {
          id: string
          location: string
          name: string
          quantity: number
          reorder_level: number
          unit: string
        }[]
      }
      staff_list_vendors: {
        Args: never
        Returns: {
          category: string
          contract_end: string
          id: string
          name: string
          phone: string
        }[]
      }
      staff_log_asset_service: {
        Args: { _asset: string; _kind: string; _notes: string }
        Returns: string
      }
      staff_my_context: { Args: never; Returns: Json }
      staff_my_maintenance: {
        Args: { _include_done?: boolean }
        Returns: {
          asset_location: string
          asset_name: string
          completed_at: string
          due_on: string
          id: string
          instructions: string
          staff_note: string
          started_at: string
          status: string
          title: string
        }[]
      }
      staff_my_tickets: {
        Args: { _include_done?: boolean }
        Returns: {
          asset_location: string
          asset_name: string
          category: string
          created_at: string
          description: string
          flat_label: string
          hold_reason: string
          id: string
          priority: string
          sla_due_at: string
          status: string
          subject: string
          ticket_no: number
        }[]
      }
      staff_ticket_timeline: {
        Args: { _ticket: string }
        Returns: {
          actor_kind: string
          body: string
          created_at: string
          from_status: string
          kind: string
          to_status: string
        }[]
      }
      staff_update_maintenance: {
        Args: { _id: string; _note: string; _status: string }
        Returns: undefined
      }
      staff_update_ticket: {
        Args: { _note: string; _status: string; _ticket: string }
        Returns: undefined
      }
      staff_use_inventory: {
        Args: { _item: string; _qty: number; _reason: string }
        Returns: number
      }
      start_society_trial: { Args: { _society_id: string }; Returns: string }
      start_trial_for_society: {
        Args: { _society_id: string }
        Returns: string
      }
      store_income_category_suggestion:
        | {
            Args: {
              _actor_id: string
              _category_id: string
              _confidence: string
              _explanation: string
              _record_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _category_id: string
              _confidence: string
              _explanation: string
              _record_id: string
            }
            Returns: Json
          }
      submit_join_request: {
        Args: {
          _code: string
          _flat_number: string
          _full_name: string
          _mobile: string
          _owner_or_tenant: string
          _society_id: string
        }
        Returns: string
      }
      submit_no_dues_request_internal: {
        Args: {
          _actor_id: string
          _flat_id: string
          _purpose: string
          _society_id: string
        }
        Returns: {
          eligibility: Json
          request_id: string
          status: Database["public"]["Enums"]["no_dues_status"]
        }[]
      }
      submit_offline_payment: {
        Args: {
          _actor_role: string
          _amount: number
          _bill_id: string
          _idempotency_key: string
          _method: string
          _notes: string
          _payment_date: string
          _reference_no: string
        }
        Returns: string
      }
      submit_survey_response: {
        Args: { _answers: Json; _poll_id: string }
        Returns: undefined
      }
      submit_upi_qr_payment: {
        Args: {
          _bill_id: string
          _idempotency_key: string
          _proof_path: string
          _reference_no: string
        }
        Returns: string
      }
      switch_active_home: { Args: { _flat_id: string }; Returns: Json }
      switch_active_society: {
        Args: { _society_id: string }
        Returns: undefined
      }
      tenancy_state: {
        Args: {
          _access_expires_at: string
          _archived_at: string
          _invited_at: string
          _is_active: boolean
          _lease_ends_on: string
          _moved_in_at: string
          _moved_out_at: string
          _notice: string
          _termination_kind: string
          _warn: number
        }
        Returns: string
      }
      touch_last_active: { Args: never; Returns: undefined }
      touch_rate_limit: {
        Args: {
          _bucket: string
          _limit: number
          _subject: string
          _window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
      transition_income_reconciliation: {
        Args: {
          _action: string
          _reason?: string
          _record_id: string
          _reference?: string
        }
        Returns: Json
      }
      transition_income_record: {
        Args: { _reason?: string; _record_id: string; _target_status: string }
        Returns: Json
      }
      transition_no_dues_request_internal: {
        Args: {
          _actor_id: string
          _decision: string
          _notes: string
          _reason: string
          _request_id: string
        }
        Returns: {
          eligibility: Json
          new_status: Database["public"]["Enums"]["no_dues_status"]
        }[]
      }
      unmatch_bank_line: {
        Args: { _line_id: string; _reason: string }
        Returns: Json
      }
      update_society_business_profile: {
        Args: {
          _business_address: string
          _business_city: string
          _business_gstin: string
          _business_pan: string
          _business_pincode: string
          _business_state: string
          _legal_business_name: string
          _society_id: string
        }
        Returns: undefined
      }
      update_society_payout_setup_internal: {
        Args: {
          _actor_id: string
          _bank_last4: string
          _holder_name: string
          _payout_status: string
          _razorpay_account_id: string
          _society_id: string
        }
        Returns: Json
      }
      update_society_unit: {
        Args: {
          _display_order?: number
          _flat_number?: string
          _floor?: number
          _unit_id: string
          _unit_type?: string
        }
        Returns: Json
      }
      upsert_finance_vendor: {
        Args: {
          _category: string
          _email: string
          _name: string
          _notes: string
          _phone: string
          _society_id: string
          _vendor_id: string
        }
        Returns: string
      }
      user_can_admin_migrations: {
        Args: { _society_id: string; _user_id: string }
        Returns: boolean
      }
      user_has_verified_phone_internal: {
        Args: { _user_id: string }
        Returns: boolean
      }
      vendor_performance: {
        Args: never
        Returns: {
          avg_rating: number
          last_service: string
          rating_count: number
          recent_avg: number
          recent_count: number
          service_visits: number
          tickets_open: number
          tickets_overdue: number
          tickets_total: number
          vendor_id: string
        }[]
      }
      vendor_rate_ticket: {
        Args: { _comment: string; _rating: number; _ticket: string }
        Returns: string
      }
      vendor_rating_history: {
        Args: { _vendor: string }
        Returns: {
          asset_name: string
          comment: string
          created_at: string
          id: string
          moderation_reason: string
          rater_label: string
          rating: number
          service_kind: string
          source: string
          status: string
          ticket_no: number
        }[]
      }
      vendor_rating_status: {
        Args: { _ticket: string }
        Returns: {
          eligible: boolean
          my_rating: number
          rated: boolean
          vendor_name: string
        }[]
      }
      vendor_service_log_unrated: {
        Args: { _vendor: string }
        Returns: {
          asset_name: string
          id: string
          kind: string
          service_date: string
        }[]
      }
      verify_offline_payment: {
        Args: { _notes: string; _payment_id: string }
        Returns: Json
      }
      verify_resident_kyc: {
        Args: { _approved: boolean; _reason?: string; _user_id: string }
        Returns: undefined
      }
      verify_scheduler_token: { Args: { _token: string }; Returns: boolean }
      visitor_allowed_minutes: { Args: { _cat: string }; Returns: number }
      visitor_invite: {
        Args: {
          _category: string
          _expected_at: string
          _flat_id: string
          _name: string
          _phone: string
          _purpose: string
          _valid_hours: number
          _vehicle: string
        }
        Returns: {
          gate_pass_code: string
          id: string
        }[]
      }
      visitor_resident_action: {
        Args: { _action: string; _id: string }
        Returns: undefined
      }
      vote_cast: {
        Args: { _option: string; _poll: string }
        Returns: undefined
      }
      vote_create: {
        Args: {
          _closes_at: string
          _description: string
          _eligibility: string
          _options: string[]
          _secret: boolean
          _title: string
        }
        Returns: string
      }
      vote_results: {
        Args: { _poll: string }
        Returns: {
          eligible_count: number
          label: string
          option_id: string
          total_cast: number
          visible: boolean
          votes: number
        }[]
      }
      vote_set_status: {
        Args: { _id: string; _status: string }
        Returns: undefined
      }
      vote_status_for_me: {
        Args: { _poll_ids: string[] }
        Returns: {
          eligible: boolean
          my_option: string
          poll_id: string
          voted: boolean
        }[]
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "society_admin"
        | "resident"
        | "block_admin"
        | "security"
        | "auditor"
        | "staff"
      hierarchy_kind: "society" | "structure" | "floor" | "unit"
      migration_entity_type:
        | "structure"
        | "unit"
        | "resident"
        | "occupancy"
        | "family"
        | "vehicle"
      migration_job_status:
        | "uploaded"
        | "mapping"
        | "validating"
        | "ready"
        | "committing"
        | "completed"
        | "failed"
        | "cancelled"
      migration_row_action: "create" | "match_existing" | "skip" | "conflict"
      migration_row_status:
        | "pending"
        | "valid"
        | "warning"
        | "error"
        | "committed"
        | "skipped"
      no_dues_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "issued"
        | "revoked"
        | "blocked_by_dues"
      society_layout: "structured" | "serial"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "society_admin",
        "resident",
        "block_admin",
        "security",
        "auditor",
        "staff",
      ],
      hierarchy_kind: ["society", "structure", "floor", "unit"],
      migration_entity_type: [
        "structure",
        "unit",
        "resident",
        "occupancy",
        "family",
        "vehicle",
      ],
      migration_job_status: [
        "uploaded",
        "mapping",
        "validating",
        "ready",
        "committing",
        "completed",
        "failed",
        "cancelled",
      ],
      migration_row_action: ["create", "match_existing", "skip", "conflict"],
      migration_row_status: [
        "pending",
        "valid",
        "warning",
        "error",
        "committed",
        "skipped",
      ],
      no_dues_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "issued",
        "revoked",
        "blocked_by_dues",
      ],
      society_layout: ["structured", "serial"],
    },
  },
} as const
