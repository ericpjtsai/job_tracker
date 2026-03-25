declare module 'linkedin-jobs-api' {
  interface QueryOptions {
    keyword?: string
    location?: string
    dateSincePosted?: string
    jobType?: string
    remoteFilter?: string
    salary?: string
    experienceLevel?: string
    limit?: string
  }

  interface JobResult {
    position?: string
    company?: string
    location?: string
    date?: string
    agoTime?: string
    salary?: string
    jobUrl?: string
    companyLogo?: string
    description?: string
  }

  export function query(options: QueryOptions): Promise<JobResult[]>
}
