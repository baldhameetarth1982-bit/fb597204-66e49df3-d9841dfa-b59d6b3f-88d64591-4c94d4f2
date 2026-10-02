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
      parking_slots: {
        Row: {
          created_at: string
          flat_id: string | null
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
          created_at?: string
          flat_id?: string | null
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
          created_at?: string
          flat_id?: string | null
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
          extracted_text: string | null
          faq_answer: string | null
          file_name: string | null
          id: string
          kind: string
          mime_type: string | null
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
          extracted_text?: string | null
          faq_answer?: string | null
          file_name?: string | null
          id?: string
          kind: string
          mime_type?: string | null
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
          extracted_text?: string | null
          faq_answer?: string | null
          file_name?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
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
      _can_manage_polls: { Args: { _society_id: string }; Returns: boolean }
      _deactivate_resident_role_if_homeless: {
        Args: { _society: string; _user: string }
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
      _finance_require_admin: { Args: { _society_id: string }; Returns: string }
      _finance_seed_accounts: {
        Args: { _actor_id: string; _society_id: string }
        Returns: undefined
      }
      _gate_admin_society: { Args: never; Returns: string }
      _gate_society: { Args: never; Returns: string }
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
      _helpdesk_is_admin: { Args: { _sid: string }; Returns: boolean }
      _helpdesk_sla_hours: { Args: { _priority: string }; Returns: number }
      _knowledge_admin_society: { Args: never; Returns: string }
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
      _ops_admin: { Args: { _sid: string }; Returns: string }
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
      _rate_hit: {
        Args: {
          _bucket: string
          _max: number
          _subject: string
          _window: string
        }
        Returns: undefined
      }
      _survey_notify: { Args: { _poll_id: string }; Returns: undefined }
      _sync_bill_payment_state: {
        Args: { _bill_id: string }
        Returns: undefined
      }
      _tenancy_row_society: {
        Args: { _flat_resident_id: string }
        Returns: string
      }
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
      admin_cancel_society_plan: {
        Args: { _reason: string; _society_id: string }
        Returns: Json
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
      admin_extend_trial: {
        Args: { _days: number; _reason: string; _society_id: string }
        Returns: Json
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
      admin_parking_archive: { Args: { _id: string }; Returns: undefined }
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
      admin_record_attendance: {
        Args: { _day: string; _note: string; _staff: string; _status: string }
        Returns: undefined
      }
      admin_renew_tenancy: {
        Args: { _flat_resident_id: string; _new_lease_ends_on: string }
        Returns: undefined
      }
      admin_reset_society_branding: {
        Args: { _society_id: string }
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
      duplicate_society_block_internal: {
        Args: { _actor_id: string; _block_id: string; _new_name: string }
        Returns: Json
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
      ensure_maintenance_period: {
        Args: {
          _amount: number
          _due_date?: string
          _flat_id: string
          _period_start: string
        }
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
      guard_offline_replay: {
        Args: { _kind: string; _op_id: string; _payload: Json }
        Returns: Json
      }
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
      import_opening_balances: {
        Args: {
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
      list_finance_workspace: {
        Args: {
          _limit?: number
          _offset?: number
          _resource: string
          _society_id: string
        }
        Returns: Json
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
      mark_aadhaar_verified: { Args: { _last4: string }; Returns: undefined }
      mark_visitor_overstays: { Args: never; Returns: number }
      meeting_add_action: {
        Args: { _due: string; _meeting: string; _owner: string; _title: string }
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
      migration_setup_checklist: {
        Args: { _society_id: string }
        Returns: Json
      }
      migration_upload_path_ok: { Args: { _name: string }; Returns: boolean }
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
      reset_own_kyc: { Args: never; Returns: undefined }
      resident_set_recurring_pass_status: {
        Args: { _id: string; _status: string }
        Returns: undefined
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
      reupload_own_kyc: {
        Args: { _aadhaar_last4: string; _aadhaar_url: string }
        Returns: undefined
      }
      reverse_finance_expense: {
        Args: { _expense_id: string; _reason: string }
        Returns: Json
      }
      reverse_offline_payment: {
        Args: { _payment_id: string; _reason: string }
        Returns: undefined
      }
      review_opening_balance: {
        Args: { _confirm: boolean; _id: string; _note: string }
        Returns: Json
      }
      revoke_no_dues_certificate_internal: {
        Args: { _actor_id: string; _certificate_id: string; _reason: string }
        Returns: undefined
      }
      run_logged_db_job: { Args: { _job: string }; Returns: string }
      saas_subscription_quote: {
        Args: { _plan_id: string; _society_id: string }
        Returns: Json
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
