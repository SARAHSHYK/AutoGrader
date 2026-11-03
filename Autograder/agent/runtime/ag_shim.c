
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define AG_SLOTS 65536
#define AG_MAX_EVENTS 16
#define AG_MAX_SITES 32
#define AG_MEMORY_EXIT 77

typedef struct {
  void *ptr;
  size_t size;
  int line;
  int state;
} ag_rec;

static ag_rec ag_tab[AG_SLOTS];
static size_t ag_live_bytes, ag_peak_bytes, ag_limit;
static unsigned long ag_total_allocs;
static int ag_untracked;
static const char *ag_report_path;
static int ag_double_free[AG_MAX_EVENTS], ag_double_free_n;

static void ag_write_report(const char *exit_kind);

static void ag_at_exit(void) { ag_write_report("normal"); }

__attribute__((constructor)) static void ag_init(void) {
  const char *limit = getenv("AG_HEAP_LIMIT");
  ag_limit = limit ? (size_t)strtoull(limit, NULL, 10) : 0;
  ag_report_path = getenv("AG_REPORT");
  atexit(ag_at_exit);
}

static ag_rec *ag_find(void *ptr, int create) {
  size_t h = (size_t)(((unsigned long long)(size_t)ptr >> 4) * 2654435761ULL) % AG_SLOTS;
  for (size_t i = 0; i < AG_SLOTS; i++) {
    ag_rec *r = &ag_tab[(h + i) % AG_SLOTS];
    if (r->state == 0) {
      if (!create) return NULL;
      r->ptr = ptr;
      return r;
    }
    if (r->ptr == ptr) return r;
  }
  return NULL;
}

static void ag_enforce_limit(size_t extra) {
  if (ag_limit && ag_live_bytes + extra > ag_limit) {
    fprintf(stderr, "\nAG_MEMORY_LIMIT_EXCEEDED\n");
    fflush(NULL);
    ag_write_report("memory_limit");
    _Exit(AG_MEMORY_EXIT);
  }
}

static void ag_track(void *ptr, size_t size, int line) {
  ag_rec *r = ag_find(ptr, 1);
  if (!r) { ag_untracked++; return; }
  r->size = size;
  r->line = line;
  r->state = 1;
  ag_live_bytes += size;
  if (ag_live_bytes > ag_peak_bytes) ag_peak_bytes = ag_live_bytes;
  ag_total_allocs++;
}

void *ag_malloc(size_t size, int line) {
  ag_enforce_limit(size);
  void *p = malloc(size);
  if (p) ag_track(p, size, line);
  return p;
}

void *ag_calloc(size_t count, size_t size, int line) {
  if (size && count > (size_t)-1 / size) return NULL;
  ag_enforce_limit(count * size);
  void *p = calloc(count, size);
  if (p) ag_track(p, count * size, line);
  return p;
}

void ag_free(void *ptr, int line) {
  if (!ptr) return;
  ag_rec *r = ag_find(ptr, 0);
  if (r && r->state == 2) {
    if (ag_double_free_n < AG_MAX_EVENTS) ag_double_free[ag_double_free_n++] = line;
    return;
  }
  if (r && r->state == 1) {
    ag_live_bytes -= r->size;
    r->state = 2;
  }
  free(ptr);
}

void *ag_realloc(void *ptr, size_t size, int line) {
  if (!ptr) return ag_malloc(size, line);
  if (size == 0) { ag_free(ptr, line); return NULL; }
  ag_rec *old = ag_find(ptr, 0);
  size_t old_size = (old && old->state == 1) ? old->size : 0;
  if (size > old_size) ag_enforce_limit(size - old_size);
  void *p = realloc(ptr, size);
  if (!p) return NULL;
  if (old && old->state == 1) {
    ag_live_bytes -= old->size;
    old->state = 2;
  }
  ag_track(p, size, line);
  ag_total_allocs--;
  return p;
}

static void ag_write_report(const char *exit_kind) {
  static int written;
  if (written || !ag_report_path) return;
  written = 1;
  FILE *f = fopen(ag_report_path, "w");
  if (!f) return;

  int site_line[AG_MAX_SITES];
  size_t site_bytes[AG_MAX_SITES];
  unsigned long site_blocks[AG_MAX_SITES];
  int sites = 0;
  unsigned long live_blocks = 0;
  for (size_t i = 0; i < AG_SLOTS; i++) {
    if (ag_tab[i].state != 1) continue;
    live_blocks++;
    int k = 0;
    while (k < sites && site_line[k] != ag_tab[i].line) k++;
    if (k == sites) {
      if (sites == AG_MAX_SITES) continue;
      site_line[k] = ag_tab[i].line;
      site_bytes[k] = 0;
      site_blocks[k] = 0;
      sites++;
    }
    site_bytes[k] += ag_tab[i].size;
    site_blocks[k]++;
  }

  fprintf(f, "{\"exit\":\"%s\",\"live_blocks\":%lu,\"live_bytes\":%llu,\"peak_bytes\":%llu,"
             "\"total_allocs\":%lu,\"untracked\":%d,\"leaks\":[",
          exit_kind, live_blocks, (unsigned long long)ag_live_bytes,
          (unsigned long long)ag_peak_bytes, ag_total_allocs, ag_untracked);
  for (int k = 0; k < sites; k++)
    fprintf(f, "%s{\"line\":%d,\"bytes\":%llu,\"blocks\":%lu}", k ? "," : "", site_line[k],
            (unsigned long long)site_bytes[k], site_blocks[k]);
  fprintf(f, "],\"double_free_lines\":[");
  for (int k = 0; k < ag_double_free_n; k++) fprintf(f, "%s%d", k ? "," : "", ag_double_free[k]);
  fprintf(f, "]}\n");
  fclose(f);
}
