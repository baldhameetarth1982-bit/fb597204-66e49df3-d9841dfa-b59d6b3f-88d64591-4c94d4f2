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
      bills: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          flat_id: string
          id: string
          notes: string | null
          period_end: string
          period_label: string
          period_start: string
          society_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          flat_id: string
          id?: string
          notes?: string | null
          period_end: string
          period_label: string
          period_start: string
          society_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          flat_id?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_label?: string
          period_start?: string
          society_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
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
          reference_no: string | null
          society_id: string
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
          reference_no?: string | null
          society_id: string
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
          reference_no?: string | null
          society_id?: string
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
          razorpay_configured: boolean
          razorpay_key_id: string | null
          razorpay_key_secret: string | null
          updated_at: string
        }
        Insert: {
          ads_banner_enabled?: boolean
          ads_banner_placements?: string[]
          ads_interstitial_enabled?: boolean
          ads_interstitial_seconds?: number
          id?: number
          razorpay_configured?: boolean
          razorpay_key_id?: string | null
          razorpay_key_secret?: string | null
          updated_at?: string
        }
        Update: {
          ads_banner_enabled?: boolean
          ads_banner_placements?: string[]
          ads_interstitial_enabled?: boolean
          ads_interstitial_seconds?: number
          id?: number
          razorpay_configured?: boolean
          razorpay_key_id?: string | null
          razorpay_key_secret?: string | null
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
          accepted_terms_at: string | null
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          referral_code: string | null
          referred_by: string | null
          society_id: string | null
          theme: string
          updated_at: string
        }
        Insert: {
          accepted_terms_at?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          society_id?: string | null
          theme?: string
          updated_at?: string
        }
        Update: {
          accepted_terms_at?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
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
      societies: {
        Row: {
          address: string | null
          billing_active: boolean
          city: string | null
          created_at: string
          id: string
          invite_code: string | null
          logo_url: string | null
          name: string
          pincode: string | null
          plan: string
          plan_id: string | null
          registration_no: string | null
          state: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          billing_active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          invite_code?: string | null
          logo_url?: string | null
          name: string
          pincode?: string | null
          plan?: string
          plan_id?: string | null
          registration_no?: string | null
          state?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          billing_active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          invite_code?: string | null
          logo_url?: string | null
          name?: string
          pincode?: string | null
          plan?: string
          plan_id?: string | null
          registration_no?: string | null
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
      support_tickets: {
        Row: {
          ai_transcript: Json | null
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
          created_at: string
          entry_at: string
          exit_at: string | null
          flat_id: string | null
          flat_number: string | null
          id: string
          logged_by: string
          phone: string | null
          purpose: string | null
          society_id: string
          vehicle_number: string | null
          visitor_name: string
        }
        Insert: {
          created_at?: string
          entry_at?: string
          exit_at?: string | null
          flat_id?: string | null
          flat_number?: string | null
          id?: string
          logged_by: string
          phone?: string | null
          purpose?: string | null
          society_id: string
          vehicle_number?: string | null
          visitor_name: string
        }
        Update: {
          created_at?: string
          entry_at?: string
          exit_at?: string | null
          flat_id?: string | null
          flat_number?: string | null
          id?: string
          logged_by?: string
          phone?: string | null
          purpose?: string | null
          society_id?: string
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
      apply_referral_for_current_user: {
        Args: { _code: string }
        Returns: boolean
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
      generate_referral_code: { Args: never; Returns: string }
      generate_society_code: { Args: never; Returns: string }
      get_admin_block_ids: { Args: { _user_id: string }; Returns: string[] }
      get_admin_society_ids: { Args: { _user_id: string }; Returns: string[] }
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
      get_user_society_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
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
