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
      ads: {
        Row: {
          active: boolean
          created_at: string
          id: string
          image_path: string | null
          image_url: string
          link_url: string
          placement: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          image_path?: string | null
          image_url: string
          link_url: string
          placement?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          image_path?: string | null
          image_url?: string
          link_url?: string
          placement?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
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
      bills: {
        Row: {
          amount: number
          bill_date: string
          bill_number: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          flat_id: string
          id: string
          last_decay_date: string | null
          notes: string | null
          paid_at: string | null
          period_end: string
          period_label: string
          period_start: string
          replaced_by_bill_id: string | null
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          bill_date?: string
          bill_number?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_date: string
          flat_id: string
          id?: string
          last_decay_date?: string | null
          notes?: string | null
          paid_at?: string | null
          period_end: string
          period_label: string
          period_start: string
          replaced_by_bill_id?: string | null
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bill_date?: string
          bill_number?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_date?: string
          flat_id?: string
          id?: string
          last_decay_date?: string | null
          notes?: string | null
          paid_at?: string | null
          period_end?: string
          period_label?: string
          period_start?: string
          replaced_by_bill_id?: string | null
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_replaced_by_bill_id_fkey"
            columns: ["replaced_by_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          society_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          society_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          society_id?: string
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
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          society_id: string
          spent_on: string
          updated_at: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          society_id: string
          spent_on?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          society_id?: string
          spent_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_society_id_fkey"
            columns: ["society_id"]
            isOneToOne: false
            referencedRelation: "societies"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          age: number | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          relation: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          created_at?: string
          full_name: string
          id?: string
          phone?: string | null
          relation: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          relation?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      flat_residents: {
        Row: {
          created_at: string
          flat_id: string
          id: string
          is_primary: boolean
          moved_in_at: string | null
          relationship: string
          user_id: string
        }
        Insert: {
          created_at?: string
          flat_id: string
          id?: string
          is_primary?: boolean
          moved_in_at?: string | null
          relationship?: string
          user_id: string
        }
        Update: {
          created_at?: string
          flat_id?: string
          id?: string
          is_primary?: boolean
          moved_in_at?: string | null
          relationship?: string
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
      flats: {
        Row: {
          area_sqft: number | null
          block_id: string
          created_at: string
          flat_number: string
          floor: number | null
          id: string
          society_id: string
          status: string
          type: string | null
          unit_type: string
          updated_at: string
        }
        Insert: {
          area_sqft?: number | null
          block_id: string
          created_at?: string
          flat_number: string
          floor?: number | null
          id?: string
          society_id: string
          status?: string
          type?: string | null
          unit_type?: string
          updated_at?: string
        }
        Update: {
          area_sqft?: number | null
          block_id?: string
          created_at?: string
          flat_number?: string
          floor?: number | null
          id?: string
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
      join_requests: {
        Row: {
          created_at: string
          flat_id: string
          id: string
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
          flat_id: string
          id?: string
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
          flat_id?: string
          id?: string
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
      payments: {
        Row: {
          amount: number
          bill_id: string
          created_at: string
          flat_id: string
          id: string
          method: string
          notes: string | null
          paid_at: string
          platform_fee_paise: number | null
          platform_share_paise: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          reference_no: string | null
          society_id: string
          society_share_paise: number | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          bill_id: string
          created_at?: string
          flat_id: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          platform_fee_paise?: number | null
          platform_share_paise?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          reference_no?: string | null
          society_id: string
          society_share_paise?: number | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string
          created_at?: string
          flat_id?: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          platform_fee_paise?: number | null
          platform_share_paise?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          reference_no?: string | null
          society_id?: string
          society_share_paise?: number | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
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
          sort_order?: number
          trial_days?: number
          txn_fee_pct?: number
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          ads_banner_enabled: boolean
          ads_banner_placements: string[]
          ads_interstitial_enabled: boolean
          ads_interstitial_seconds: number
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
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
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
          closes_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          society_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          society_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
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
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_offline: boolean
          phone: string | null
          referral_code: string | null
          referred_by: string | null
          society_id: string | null
          theme: string
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
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_offline?: boolean
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          society_id?: string | null
          theme?: string
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
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_offline?: boolean
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          society_id?: string | null
          theme?: string
          updated_at?: string
        }
        Relationships: [
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
      societies: {
        Row: {
          address: string | null
          bill_theme: string
          billing_active: boolean
          city: string | null
          created_at: string
          id: string
          invite_code: string | null
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
          signature_url: string | null
          state: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bill_theme?: string
          billing_active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          invite_code?: string | null
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
          signature_url?: string | null
          state?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bill_theme?: string
          billing_active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          invite_code?: string | null
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
          signature_url?: string | null
          state?: string | null
          status?: string
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
      society_settings: {
        Row: {
          address: string | null
          bylaws_html: string | null
          bylaws_pdf_path: string | null
          city: string | null
          created_at: string
          financial_year_start_month: number
          grace_days: number
          late_fee_amount: number
          late_fee_type: string
          maintenance_due_day: number
          maintenance_frequency: string
          opening_balance_date: string | null
          opening_bank: number
          opening_cash: number
          pincode: string | null
          registration_no: string | null
          setup_completed_at: string | null
          society_id: string
          state: string | null
          structure_type: string
          updated_at: string
          wizard_step: number
        }
        Insert: {
          address?: string | null
          bylaws_html?: string | null
          bylaws_pdf_path?: string | null
          city?: string | null
          created_at?: string
          financial_year_start_month?: number
          grace_days?: number
          late_fee_amount?: number
          late_fee_type?: string
          maintenance_due_day?: number
          maintenance_frequency?: string
          opening_balance_date?: string | null
          opening_bank?: number
          opening_cash?: number
          pincode?: string | null
          registration_no?: string | null
          setup_completed_at?: string | null
          society_id: string
          state?: string | null
          structure_type?: string
          updated_at?: string
          wizard_step?: number
        }
        Update: {
          address?: string | null
          bylaws_html?: string | null
          bylaws_pdf_path?: string | null
          city?: string | null
          created_at?: string
          financial_year_start_month?: number
          grace_days?: number
          late_fee_amount?: number
          late_fee_type?: string
          maintenance_due_day?: number
          maintenance_frequency?: string
          opening_balance_date?: string | null
          opening_bank?: number
          opening_cash?: number
          pincode?: string | null
          registration_no?: string | null
          setup_completed_at?: string | null
          society_id?: string
          state?: string | null
          structure_type?: string
          updated_at?: string
          wizard_step?: number
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
      support_tickets: {
        Row: {
          ai_transcript: Json | null
          category: string
          created_at: string
          description: string
          id: string
          priority: string
          society_id: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_transcript?: Json | null
          category?: string
          created_at?: string
          description: string
          id?: string
          priority?: string
          society_id?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_transcript?: Json | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          priority?: string
          society_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_points: {
        Row: {
          created_at: string
          id: string
          points: number
          reason: string
          society_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          points: number
          reason: string
          society_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          points?: number
          reason?: string
          society_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          block_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          society_id: string | null
          user_id: string
        }
        Insert: {
          block_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          society_id?: string | null
          user_id: string
        }
        Update: {
          block_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          society_id?: string | null
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
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          flat_id: string | null
          id: string
          make_model: string | null
          plate_number: string
          society_id: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          flat_id?: string | null
          id?: string
          make_model?: string | null
          plate_number: string
          society_id: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          flat_id?: string | null
          id?: string
          make_model?: string | null
          plate_number?: string
          society_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      visitors: {
        Row: {
          approved_by: string | null
          created_at: string
          entry_at: string
          exit_at: string | null
          expected_at: string | null
          flat_id: string | null
          flat_number: string | null
          gate_pass_code: string | null
          id: string
          logged_by: string
          notes: string | null
          phone: string | null
          pre_approved: boolean
          purpose: string | null
          society_id: string
          status: string
          vehicle_number: string | null
          visitor_name: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          entry_at?: string
          exit_at?: string | null
          expected_at?: string | null
          flat_id?: string | null
          flat_number?: string | null
          gate_pass_code?: string | null
          id?: string
          logged_by: string
          notes?: string | null
          phone?: string | null
          pre_approved?: boolean
          purpose?: string | null
          society_id: string
          status?: string
          vehicle_number?: string | null
          visitor_name: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          entry_at?: string
          exit_at?: string | null
          expected_at?: string | null
          flat_id?: string | null
          flat_number?: string | null
          gate_pass_code?: string | null
          id?: string
          logged_by?: string
          notes?: string | null
          phone?: string | null
          pre_approved?: boolean
          purpose?: string | null
          society_id?: string
          status?: string
          vehicle_number?: string | null
          visitor_name?: string
        }
        Relationships: []
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
      activate_society_plan: {
        Args: { _months?: number; _plan_id: string; _society_id: string }
        Returns: undefined
      }
      admin_apply_custom_plan: {
        Args: { _custom_plan_id: string }
        Returns: boolean
      }
      admin_assign_resident_to_flat: {
        Args: {
          _flat_id: string
          _is_primary?: boolean
          _relationship?: string
          _user_id: string
        }
        Returns: string
      }
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
      admin_grant_society_plan: {
        Args: {
          _extend?: boolean
          _months?: number
          _plan_id: string
          _society_id: string
        }
        Returns: undefined
      }
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
      apply_overdue_point_decay: { Args: never; Returns: number }
      apply_referral_for_current_user: {
        Args: { _code: string }
        Returns: boolean
      }
      authorize_membership: {
        Args: { _society_id: string; _user_id: string }
        Returns: boolean
      }
      cancel_bill: {
        Args: { _bill_id: string; _reason: string }
        Returns: undefined
      }
      complete_setup_wizard: {
        Args: { _society_id: string }
        Returns: undefined
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
      ensure_maintenance_period: {
        Args: {
          _amount: number
          _due_date?: string
          _flat_id: string
          _period_start: string
        }
        Returns: string
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
      get_admin_block_ids: { Args: { _user_id: string }; Returns: string[] }
      get_admin_society_ids: { Args: { _user_id: string }; Returns: string[] }
      get_current_auth_context: {
        Args: never
        Returns: {
          primary_role: string
          profile: Json
          roles: Json
          society_id: string
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
      get_razorpay_public_config: {
        Args: never
        Returns: {
          configured: boolean
          key_id: string
        }[]
      }
      get_society_invite_code: {
        Args: { _society_id: string }
        Returns: string
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
      get_user_society_id: { Args: { _user_id: string }; Returns: string }
      guard_checkin_by_code: {
        Args: { _code: string; _society_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_society_plan: {
        Args: { _society_id: string }
        Returns: boolean
      }
      is_block_admin: {
        Args: { _block_id: string; _user_id: string }
        Returns: boolean
      }
      is_razorpay_live: { Args: never; Returns: boolean }
      is_society_admin_for: {
        Args: { _society_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      join_society_with_code: { Args: { _code: string }; Returns: string }
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
      mark_aadhaar_verified: { Args: { _last4: string }; Returns: undefined }
      request_join_flat: {
        Args: { _flat_id: string; _relationship: string }
        Returns: string
      }
      reset_own_kyc: { Args: never; Returns: undefined }
      respond_join_request: {
        Args: { _approve: boolean; _reason?: string; _request_id: string }
        Returns: undefined
      }
      reupload_own_kyc: {
        Args: { _aadhaar_last4: string; _aadhaar_url: string }
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
      society_has_access: { Args: { _society_id: string }; Returns: boolean }
      society_payout_active: { Args: { _society_id: string }; Returns: boolean }
      start_trial_for_society: {
        Args: { _society_id: string }
        Returns: string
      }
      verify_resident_kyc: {
        Args: { _approved: boolean; _reason?: string; _user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "society_admin"
        | "resident"
        | "block_admin"
        | "security"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      ],
    },
  },
} as const
