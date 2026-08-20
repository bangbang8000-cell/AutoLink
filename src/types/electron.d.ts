interface Window {
  electron: {
    project: {
      list: () => Promise<{ id: number; name: string; index: number; status?: 'ready' | 'planned' | 'configured' | 'designed' | 'layouted'; fileCount?: number; updatedAt?: string; description?: string }[]>
      create: (name: string, options?: { template?: string; empty?: boolean }) => Promise<void>
      createWithConfig: (config: import('@/types/project-config').ProjectConfig) => Promise<void>
      delete: (ids: string[]) => Promise<void>
      duplicate: (sourceName: string, targetName: string) => Promise<void>
      rename: (oldName: string, newName: string) => Promise<void>
      exportZip: (projectName: string, options?: { password?: string }) => Promise<{ canceled: boolean; zipPath: string }>
      importZip: (options?: { projectName?: string; zipPath?: string; password?: string }) => Promise<{ canceled: boolean; projectName: string }>
      batchExportZip: (projectNames: string[], options?: { password?: string }) => Promise<{
        canceled: boolean
        result: {
          successes: { name: string; zipPath: string }[]
          failures: { name: string; error: string }[]
        } | null
        targetDir: string
      }>
      getStructure: (name: string) => Promise<import('@/types/file-tree').FileTreeNode[]>
      getConfigFile: (name: string) => Promise<string | null>
      saveConfigFile: (name: string, content: string) => Promise<void>
      // T6.1: 通用项目文件保存(白名单: topology.json, rack_layout.json)
      saveFile: (name: string, relativePath: string, content: string) => Promise<string>
      getFile: (name: string, filePath: string) => Promise<string | null>
      getFileBinary: (name: string, filePath: string) => Promise<string | null>
      listOutputFiles: (name: string) => Promise<{ name: string; type: string }[]>
      listOutputBatches: (projectName: string) => Promise<import('@/types/file-tree').OutputBatch[]>
      deleteOutputFile: (projectName: string, filePath: string) => Promise<void>
      deleteOutputBatch: (projectName: string, batchName: string) => Promise<void>
      clearOutput: (projectName: string) => Promise<void>
    }
    template: {
      getStructure: (templateName: string) => Promise<import('@/types/file-tree').FileTreeNode[]>
      getFile: (templateName: string, filePath: string) => Promise<string | null>
      getConfig: (templateName: string) => Promise<import('@/types/project-config').ProjectConfig | null>
      list: () => Promise<Array<{
        id: string; name: string; description: string; scenario: string; tags: string[]; updatedAt: string; isBuiltin: boolean
        summary: {
          numGpuServers: number; numAllFlashStorage: number; numHybridFlashStorage: number; numComputeServers: number
          paramProtocol: string; paramSpeed: string; storageSpeed: string; powerLimitPerRack: number
        } | null
      }>>
      preview: (templateName: string) => Promise<{
        success: boolean
        error?: string
        summary?: {
          numServers: number; numGpuServers: number
          paramLeafCount: number; paramSpineCount: number; paramCoreCount: number
          storageLeafCount: number; storageSpineCount: number
          paramSpeed: string; storageSpeed: string; paramProtocol: string
          totalRacks: number; totalPowerWatts: number
          valid: boolean; errors: string[]
          convergence: Array<{ networkType?: string; convergenceRatio?: number; meetsTarget?: boolean; recommendation?: string }> | null
        }
      }>
      healthCheck: () => Promise<{
        checked: number
        healthyCount: number
        unhealthy: Array<{
          id: string
          name: string
          isBuiltin: boolean
          issues: { type: 'missing_json' | 'invalid_json' | 'invalid_config' | 'bad_ref' | 'unresolved_ref'; detail: string }[]
        }>
      }>
      create: (projectName: string, meta: { name: string; description?: string; scenario?: string; tags?: string[] }) => Promise<void>
      delete: (templateName: string) => Promise<void>
      update: (templateName: string, updates: {
        name?: string
        description?: string
        scenario?: string
        tags?: string[]
        configContent?: string
        projectConfig?: string
      }) => Promise<void>
      exportZip: (templateName: string, options?: { password?: string }) => Promise<{ canceled: boolean; zipPath: string }>
      importZip: (options?: { templateName?: string; zipPath?: string; password?: string }) => Promise<{ canceled: boolean; templateName: string }>
    }
    design: {
      generate: (projectName: string, configINI?: string) => Promise<unknown>
      validate: (projectName: string, configINI?: string) => Promise<unknown>
      estimate: (projectName: string, estimateParams?: Record<string, unknown>) => Promise<unknown>
      report: (projectName: string) => Promise<unknown>
    }
    // P1.3: AIDC 规划（宏观参数 → plan:table）
    // G2: 导出 plan:table（json|excel，保存对话框在主进程）
    aidc: {
      plan: (params?: Record<string, unknown>) => Promise<unknown>
      exportPlan: (params: Record<string, unknown>, format: 'json' | 'excel' | 'zip') => Promise<{
        canceled?: boolean; path?: string; ok?: boolean; error?: string
      }>
      /** P1（V-AL4）：保存拓扑 PNG（base64 → 文件） */
      savePng: (base64: string, defaultName: string) => Promise<{
        canceled?: boolean; path?: string; error?: string
      }>
      /** P1（A-3/A-5/A-7）：AIDC 项目化 */
      project: {
        create: (name: string, macro: Record<string, unknown>, projectId?: string) => Promise<{
          error?: string; ok?: boolean; name?: string; projectId?: string
          plan?: unknown; planVersion?: number; changed?: boolean
        }>
        save: (name: string, macro: Record<string, unknown>) => Promise<{
          error?: string; ok?: boolean; name?: string; projectId?: string
          plan?: unknown; planVersion?: number; changed?: boolean
        }>
        init: (name: string, macro: Record<string, unknown>) => Promise<{
          error?: string; ok?: boolean; name?: string; projectId?: string
          plan?: unknown; planVersion?: number; changed?: boolean
        }>
        load: (name: string) => Promise<{
          error?: string; ok?: boolean; name?: string; projectId?: string; projectName?: string
          plan?: unknown; macro?: unknown; history?: Array<{ version: number; planHash: string; generatedAt?: string }>
        }>
        list: () => Promise<{
          error?: string; ok?: boolean; projects?: Array<{
            name: string; projectId: string; projectName: string; planVersion: number
            updatedAt?: string; site?: string; gpuCount?: number
          }>
        }>
      }
    }
    // V3.1.3-T7-4: 容量规划（模型档案 + 推荐）
    capacity: {
      listPresets: () => Promise<{
        presets: Array<{
          id: string
          name: string
          model_type: string
          num_params: number
          context_length: number
          precision: string
          num_experts: number
          // V3.2.0-T9-5: 来源标注（内置/国产 + 芯片厂商）
          source?: string
          vendor?: string
        }>
        total: number
        domesticCount?: number
      }>
      recommend: (params: {
        model: string
        numGpus: number
        budget?: string
        precision?: string
        contextLength?: number
        tp?: number
        dp?: number
        pp?: number
        costParams?: Record<string, number>
      }) => Promise<{
        success: boolean
        error?: string
        estimated?: boolean
        estimation?: {
          label: string
          method: string
          accuracy: string
          note: string
        }
        model?: {
          name: string
          model_type: string
          num_params_b: number
          context_length: number
          precision: string
          num_experts: number
        }
        comm?: {
          total_gib: number
          comm_ratio: number
        }
        recommendation?: {
          scale_up_protocol: string
          scale_up_domain: number
          scale_out_protocol: string
          scale_out_speed: string
          convergence_ratio: number
          tier_count: number
          estimated_comm_overhead: number
        }
        // V3.2.0-T9-1: FP8 精确通信 / Pipeline 显存 / TCO 成本
        exact?: {
          total_gib: number
          comm_ratio: number
          grad_bpp: number
          memory_gib: number
          pipeline_peak_gib: number
          analytic_error_pct: number
        }
        pipeline?: {
          pp_size: number
          stages: number
          params_per_stage_b: number
          peak_per_stage_gib: number
          activation_gib: number
        }
        cost?: {
          total_usd: number
          hardware: { switches: number; nic: number; modules: number; subtotal_usd: number }
          power: { kwh_per_year: number; subtotal_usd: number }
          space: { racks: number; subtotal_usd: number }
        }
        notes?: Array<{ level: string; message: string }>
      }>
    }
    // V3.2.0-T9-2: ATOP 自动拓扑优化（通信特征 → ZCube cube 拓扑推荐）
    atop: {
      recommend: (params: {
        numGpus: number
        model?: string
        modelType?: string
        numExperts?: number
        precision?: string
        tp?: number
        dp?: number
        pp?: number
        communicationPattern?: string
        commRatio?: number
        traffic?: Record<string, number>
        switchPorts?: number
      }) => Promise<{
        success: boolean
        error?: string
        estimated?: boolean
        feature?: {
          modelName: string
          modelType: string
          communicationPattern: 'allreduce' | 'alltoall' | 'p2p'
          commRatio: number
          precision: string
          numExperts: number
          trafficBreakdown: { allreduce: number; alltoall: number; p2p: number }
          parallel: { tp: number; dp: number; pp: number }
          nicsPerGpu: number
        }
        cube?: { dims: number[]; dim: number; volume: number; numGpus: number }
        topology?: {
          nodes: Array<{
            id: string
            type: string
            group: string
            podid: string
            layerHint?: string
            maxPorts?: number
            zcubeGroup?: string
            planeId?: number
            cubeRank?: number
            cubePos?: number[]
          }>
          edges: Array<{
            source: string
            target: string
            speed: string
            cableType: string
            description: string
            networkType?: string
          }>
        }
        zcube?: {
          stats: Record<string, number>
          params: { nics_per_gpu: number; switch_ports: number; leaf_count: number }
          meta: {
            cubeDimensions: number[]
            dim: number
            numGpus: number
            nicsPerGpu: number
            leafCount: number
            switchPorts: number
            groups: { A: number; B: number }
            noSpine: boolean
          }
        }
        validation?: {
          valid: boolean
          issues: Array<{ rule_id: string; severity: string; message: string; recommendation: string }>
        }
        rationale?: { summary: string; points: string[] }
      }>
    }
    // V3.2.0-T9-3: 批量优化（收敛比/成本/散热建议生成 + 应用，轨道 B）
    optimize: {
      suggest: (params: { projectName: string }) => Promise<{
        success: boolean
        error?: string
        suggestions?: Array<{
          category: 'convergence' | 'cost' | 'thermal'
          categoryLabel: string
          title: string
          description: string
          patch: Record<string, Record<string, unknown>>
          impact: string
        }>
        total?: number
        counts?: { convergence: number; cost: number; thermal: number }
      }>
      apply: (params: {
        projectName: string
        suggestions: Array<{ category?: string; title?: string; patch: Record<string, Record<string, unknown>> }>
      }) => Promise<{
        success: boolean
        error?: string
        applied?: Array<{ category: string; title: string; patch: Record<string, Record<string, unknown>> }>
        skipped?: string[]
        issues?: string[]
      }>
    }
    // V3.2.0-T9-4: 智能修复（校验错误 → 修复 patch → 复核 → 一键应用）
    repair: {
      plan: (params: { projectName: string }) => Promise<{
        success: boolean
        error?: string
        fixes?: Array<{
          rule_id: string
          severity: string
          message: string
          recommendation: string
          patch: Record<string, Record<string, unknown>>
        }>
        fixable?: number
        totalErrors?: number
        valid?: boolean
        issues?: Array<{ rule_id: string; severity: string; message: string; recommendation: string }>
      }>
      apply: (params: {
        projectName: string
        fixes: Array<{ rule_id?: string; message?: string; patch: Record<string, Record<string, unknown>> }>
      }) => Promise<{
        success: boolean
        error?: string
        applied?: Array<{ rule_id: string; message: string; patch: Record<string, Record<string, unknown>> }>
        skipped?: string[]
        issues?: string[]
        validation?: {
          valid: boolean
          remainingErrors: number
          issues: Array<{ rule_id: string; severity: string; message: string; recommendation: string }>
        }
      }>
    }
    // V3.0.4-T3-1: 机房矩阵
    room: {
      createMatrix: (rows: string[], cols: number[], name?: string) => Promise<{
        schemaVersion?: number
        name?: string
        rows?: string[]
        cols?: number[]
        cells?: Array<{
          row: string
          col: number
          type: string
          placeholder: string | null
          cabinetId: number | null
        }>
        error?: string
      }>
      validateLayout: (layout: unknown) => Promise<{ valid: boolean; errors: string[] }>
      // V3.1.4-T8-2: 机房智能落位
      optimize: (params: {
        matrix?: unknown
        project?: string
        counts?: Record<string, number>
        cabinets?: Array<{ id: number; type: string; power_watts: number }>
        objectives?: Record<string, number>
        constraints?: { powerLimitPerRack?: number }
        timeBudgetS?: number
        resetExisting?: boolean
      }) => Promise<{
        success: boolean
        error?: string
        placements: Array<{ position: string; type: string; cabinetId: number | null; powerWatts: number }>
        scores: Record<string, number>
        issues: string[]
        stats: { total_items: number; placed: number; unplaced: number; elapsed_ms: number | null }
      }>
    }
    // V3.0.4-T3-4: 统一配置体系
    config: {
      listSchema: () => Promise<{
        schemas: Record<string, { schemaVersion: number; fields: Array<{
          key: string
          type: 'string' | 'number' | 'boolean'
          default: unknown
          group: string
          label: string
          description: string
          enum: unknown[]
        }> }>
        presets: Array<{ id: string; name: string; description: string }>
      }>
      applyPreset: (presetId: string, config: unknown) => Promise<{
        config: Record<string, unknown>
        errors: string[]
      }>
      exportConfig: (appSettings: unknown, projectConfig: unknown) => Promise<{
        payload: {
          format: string
          version: number
          exportedAt: string
          appSettings: Record<string, unknown>
          projectConfig: Record<string, unknown>
        }
      }>
      importConfig: (payload: unknown) => Promise<{
        appSettings: Record<string, unknown> | null
        projectConfig: Record<string, unknown> | null
        errors: string[]
      }>
    }
    // V3.1.0-T4-3: CLI 能力层信息与审计日志
    cli: {
      info: () => Promise<{ cliVersion: string; actions: string[] }>
      audit: (limit?: number) => Promise<{ entries: Array<Record<string, unknown>>; path: string }>
    }
    // V3.1.1-T5-4: AI 对话桥接
    aihub: {
      chat: (params: {
        sessionId: string
        message: string
        mode?: string
        provider?: string
        autonomyMode?: string
        projectName?: string
        attachments?: unknown[]
      }) => Promise<{ sessionId: string; status: string; messages: number; reply?: string | null }>
      onStream: (callback: (data: { sessionId: string; chunk: string }) => void) => () => void
      providers: () => Promise<{
        providers: Array<{ key: string; name: string; model: string; models: string[]; enabled: boolean; is_default: boolean }>
        default: string
      }>
      config: (cfg: { provider: string; apiKey: string; model?: string; baseUrl?: string }) => Promise<{ status: string; provider: string }>
      configDefault: (provider: string) => Promise<{ status: string; default_provider: string }>
      test: (cfg: { provider: string; apiKey: string; baseUrl: string; model: string }) => Promise<{ status: string; message: string }>
      models: (cfg: { baseUrl: string; apiKey: string }) => Promise<{ status: string; models: string[]; message?: string }>
      clear: (sessionId: string) => Promise<{ status: string }>
    }
    rack: {
      optimize: (params: {
        cabinets?: Array<{ id: number; type: string; totalU?: number; power_limit?: number; devices?: Array<{ id: string; startU?: number; endU?: number; power_watts?: number }> }>
        unplaced_devices?: Array<{ id: string; name: string; type: string; height?: number; power_watts?: number }>
        gpu_per_cabinet?: number
      }) => Promise<{ success?: boolean; placements?: Array<{ deviceId: string; cabinetId: number; startU: number; endU: number }>; unplaced?: string[]; issues?: string[]; stats?: { placed: number; unplaced: number } }>
    }
    render: {
      exportConnections: (projectName: string, outputTypes: string[]) => Promise<unknown>
      deleteOutput: (projects: string[]) => Promise<{ deleted: number }>
      exportOutput: (projectName: string, batchName?: string) => Promise<{ canceled?: boolean; ok?: boolean; path?: string }>
      // 打磨轮（v1.5 / AL-O1b）：前端生成物写入版本批次目录 output/<batch>/<file>
      saveOutputFile: (projectName: string, relPath: string, base64Data: string) => Promise<string>
      // 打磨轮（v1.5 / AL-O1e）：读取输出文件（预览）
      readOutputFile: (projectName: string, relPath: string) => Promise<{ base64: string; ext: string; size: number }>
      // 打磨轮（v1.5 / AL-O1f）：清空全部项目输出
      clearAllOutput: () => Promise<{ deleted: number }>
      onProgress: (callback: (data: unknown) => void) => () => void
    }
    app: {
      getPath: (name: string) => Promise<string>
      getVersion: () => Promise<string>
      getStackVersions: () => Promise<{
        app: string
        electron: string
        chrome: string
        node: string
        react: string
        typescript: string
        vite: string
        echarts: string
        xyflow: string
        i18next: string
        electronUpdater: string
        python: string
        buildNumber: string
      } | null>
      showBrandingAsset: (filename: string) => Promise<string>
      readDocFile: (filename: string) => Promise<string | null>
      checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string; error?: string }>
      downloadUpdate: () => Promise<void>
      quitAndInstall: () => void
      openReleasesPage: () => Promise<void>
      onUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) => () => void
      onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      onUpdateError: (callback: (message: string) => void) => () => void
    }
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
    }
    shell: {
      showItemInFolder: (path: string) => void
      openPath: (path: string) => Promise<string>
      openExternal: (url: string) => Promise<void>
    }
    dialog: {
      openDirectory: () => Promise<string | null>
    }
    deviceLibrary: {
      list: () => Promise<{ categories: import('@/types/device-profile').DeviceCategory[] }>
      get: (deviceId: string) => Promise<import('@/types/device-profile').LibraryDevice | null>
      save: (device: import('@/types/device-profile').LibraryDevice) => Promise<void>
      delete: (deviceId: string) => Promise<void>
      import: (devices: import('@/types/device-profile').LibraryDevice[]) => Promise<void>
      export: (deviceIds: string[], format: 'json' | 'excel' | 'zip') => Promise<string | { devices: unknown[]; format: string }>
    }
    export: {
      saveFile: (projectName: string, fileName: string, base64Data: string) => Promise<string>
    }
    // V3.3.0-T13: 云端平台（登录 + 云中心）。渲染层零网络，HTTP 由主进程 cloudService 发起。
    cloud: {
      setBaseUrl: (url: string) => Promise<void>
      getBaseUrl: () => Promise<string>
      getLoginState: () => Promise<{ baseUrl: string; hasToken: boolean }>
      health: () => Promise<{ status: string; service: string }>
      authQrcode: (platform: string) => Promise<{ session_id: string; auth_url: string; expires_in: number }>
      authPoll: (sessionId: string) => Promise<{ status: 'pending' | 'confirmed' | 'expired'; user: { id: number; username: string } | null }>
      authHealth: () => Promise<{ feishu: { configured: boolean }; qq: { configured: boolean }; wechat: { configured: boolean } }>
      logout: () => Promise<void>
      clientDashboard: () => Promise<{
        template_count: number
        project_count: number
        recent_templates: import('@/api/cloud').RemoteTemplate[]
        recent_projects: import('@/api/cloud').RemoteProject[]
      }>
      clientVersion: () => Promise<import('@/api/cloud').VersionInfo>
      clientNotifications: () => Promise<{ announcements: import('@/api/cloud').Announcement[] }>
      publicStats: () => Promise<{ total_users: number; total_templates: number; total_projects: number }>
      projectList: () => Promise<{ projects: import('@/api/cloud').RemoteProject[] }>
      projectSearch: (q: string) => Promise<{ projects: import('@/api/cloud').RemoteProject[] }>
      projectSearchPublic: (params?: { q?: string; page?: number; limit?: number }) => Promise<{
        projects: import('@/api/cloud').RemoteProject[]
        total: number
        page: number
        limit: number
      }>
      projectCreate: (data: {
        name: string
        description?: string
        private: boolean
        template_owner?: string
        template_repo?: string
        files?: { path: string; content: string }[]
      }) => Promise<import('@/api/cloud').RemoteProject>
      projectDelete: (owner: string, repo: string) => Promise<void>
      projectSyncCheck: (projects: { name: string; local_sha?: string }[]) => Promise<{
        results: Record<string, import('@/api/cloud').SyncStatusResponse>
      }>
      projectDownload: (owner: string, repo: string) => Promise<string>
      // V4-1: 项目 Fork
      projectFork: (owner: string, repo: string) => Promise<{ status: string; name: string; owner: string; html_url: string }>
      // V4-4: 大文件分片上传
      uploadFileChunked: (owner: string, repo: string, path: string, content: string) => Promise<void>
      templateList: (params?: { q?: string; category?: string; page?: number; limit?: number; sort?: string }) => Promise<{
        templates: import('@/api/cloud').RemoteTemplate[]
        total: number
        page: number
        limit: number
      }>
      templateDetail: (owner: string, repo: string) => Promise<import('@/api/cloud').RemoteTemplate>
      // V4-2: 模板统计
      templateStats: (owner: string, repo: string) => Promise<{ downloads: number; usages: number }>
      templateDownload: (owner: string, repo: string) => Promise<string>
      templateMine: () => Promise<{ templates: import('@/api/cloud').RemoteTemplate[] }>
      templatePublish: (data: {
        name: string
        description: string
        category: string
        public: boolean
        files: { path: string; content: string }[]
      }) => Promise<{ owner: string; repo: string }>
      // V3.3.2-T15-3: 模板收藏 + 权限（所有者/可编辑/只读）
      templateFavoriteAdd: (owner: string, repo: string) => Promise<{ favorited: boolean }>
      templateFavoriteRemove: (owner: string, repo: string) => Promise<{ favorited: boolean }>
      templateFavorites: () => Promise<{ templates: import('@/api/cloud').RemoteTemplate[] }>
      templatePermissions: (owner: string, repo: string) => Promise<{
        my_role: string | null
        shared: { username: string; role: string; created_at?: string }[]
      }>
      templateGrantPermission: (owner: string, repo: string, username: string, role: string) => Promise<{ username: string; role: string }>
      templateRevokePermission: (owner: string, repo: string, username: string) => Promise<{ username: string; role: null }>
      userProfile: () => Promise<import('@/api/cloud').UserProfile>
      updateUserProfile: (data: { full_name?: string; bio?: string }) => Promise<import('@/api/cloud').UserProfile>
      giteaCredentials: () => Promise<{ username: string; password: string; gitea_url: string }>
      searchFiles: (q: string, limit?: number) => Promise<{ results: import('@/api/cloud').FileSearchResult[]; total: number }>
      searchContent: (q: string, limit?: number) => Promise<{ results: import('@/api/cloud').ContentSearchResult[]; total: number }>
      collectProjectFiles: (name: string) => Promise<{ path: string; content: string }[]>
      computeProjectSha: (name: string) => Promise<string | null>
      installRemoteProject: (data: { name: string; zipData: string; owner: string; overwrite?: boolean }) => Promise<void>
      installRemoteTemplate: (data: { name: string; zipData: string; owner: string }) => Promise<void>
      // V3.3.2-T15-1: 分享链接（只读快照 → 免登录预览页）
      shareCreate: (data: { projectName: string; description?: string; expireDays?: number }) => Promise<{
        token: string
        project_name: string
        url: string
        expires_at: string
        fullUrl: string
      }>
      shareList: () => Promise<{
        shares: {
          token: string
          project_name: string
          description: string
          expires_at: string
          created_at: string
          url: string
        }[]
      }>
      shareDelete: (token: string) => Promise<{ deleted: boolean }>
    }
    // V3.3.1: 本地搜索（项目文件 / 设备库 / 模板）
    search: {
      local: (params: {
        query: string
        scope?: 'project' | 'device' | 'template' | 'all'
        maxResults?: number
      }) => Promise<import('@/api/search').LocalSearchHit[]>
    }
    onLogOutput: (callback: (data: { message: string; level?: string }) => void) => () => void
    versions: {
      node: string
      electron: string
      chromium: string
      platform: string
      arch: string
    }
  }
}

/* Extend React CSSProperties for Electron window drag region */
declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: string
  }
}

/* Allow CSS imports */
declare module '*.css' {}
