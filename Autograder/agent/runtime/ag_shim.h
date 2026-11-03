
#ifndef AG_SHIM_H
#define AG_SHIM_H

#include <stdlib.h>
#include <string.h>
#if defined(_WIN32) || defined(__GLIBC__)
#include <malloc.h>
#endif

void *ag_malloc(size_t size, int line);
void *ag_calloc(size_t count, size_t size, int line);
void *ag_realloc(void *ptr, size_t size, int line);
void ag_free(void *ptr, int line);

#define malloc(size) ag_malloc((size), __LINE__)
#define calloc(count, size) ag_calloc((count), (size), __LINE__)
#define realloc(ptr, size) ag_realloc((ptr), (size), __LINE__)
#define free(ptr) ag_free((ptr), __LINE__)

#endif
