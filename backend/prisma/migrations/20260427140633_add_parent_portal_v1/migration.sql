-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentUser" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Homework" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "subject" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Notice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuckshopMenu" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TuckshopMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageThread" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "teacherId" TEXT,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageReply" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ParentUser_parentId_key" ON "ParentUser"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ParentUser_email_key" ON "ParentUser"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentUser_parentId_idx" ON "ParentUser"("parentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Homework_schoolId_idx" ON "Homework"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Homework_schoolId_className_idx" ON "Homework"("schoolId", "className");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Homework_dueDate_idx" ON "Homework"("dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Homework_createdAt_idx" ON "Homework"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notice_schoolId_idx" ON "Notice"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notice_date_idx" ON "Notice"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notice_createdAt_idx" ON "Notice"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuckshopMenu_schoolId_idx" ON "TuckshopMenu"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuckshopMenu_date_idx" ON "TuckshopMenu"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuckshopMenu_createdAt_idx" ON "TuckshopMenu"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TuckshopMenu_schoolId_date_key" ON "TuckshopMenu"("schoolId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_schoolId_idx" ON "MessageThread"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_parentId_idx" ON "MessageThread"("parentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_teacherId_idx" ON "MessageThread"("teacherId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_learnerId_idx" ON "MessageThread"("learnerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_status_idx" ON "MessageThread"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_createdAt_idx" ON "MessageThread"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageReply_threadId_idx" ON "MessageReply"("threadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageReply_senderId_idx" ON "MessageReply"("senderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageReply_createdAt_idx" ON "MessageReply"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentUser_parentId_fkey') THEN
    ALTER TABLE "ParentUser" ADD CONSTRAINT "ParentUser_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Homework_schoolId_fkey') THEN
    ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notice_schoolId_fkey') THEN
    ALTER TABLE "Notice" ADD CONSTRAINT "Notice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TuckshopMenu_schoolId_fkey') THEN
    ALTER TABLE "TuckshopMenu" ADD CONSTRAINT "TuckshopMenu_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageThread_schoolId_fkey') THEN
    ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageThread_learnerId_fkey') THEN
    ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageThread_parentId_fkey') THEN
    ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageThread_teacherId_fkey') THEN
    ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReply_threadId_fkey') THEN
    ALTER TABLE "MessageReply" ADD CONSTRAINT "MessageReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
