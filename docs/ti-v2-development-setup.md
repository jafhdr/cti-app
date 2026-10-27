# TI V2 development setup

Use pinned backend and frontend lockfiles. Supply DATABASE_URL and authentication secrets through local environment configuration; never commit values. Apply tracked Prisma migrations to a disposable development database and generate Prisma Client before the backend build.

Set backend FEEDBACK_FOLLOW_UP_ENABLED=true. Set frontend NEXT_PUBLIC_FEEDBACK_FOLLOW_UP_ENABLED=true and NEXT_PUBLIC_IOC_LIFECYCLE_ENABLED=true. Set NEXT_PUBLIC_API_URL to the intended local API origin. Keep external provider credentials unset and workers disabled during isolated compilation. Production activation requires a separate decision.
