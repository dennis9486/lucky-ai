<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

const props = defineProps<{ direction: 'horizontal' | 'vertical' }>()
const emit = defineEmits<{ resize: [delta: number] }>()

const dragging = ref(false)
let startPos = 0

function onMouseDown(e: MouseEvent): void {
  dragging.value = true
  startPos = props.direction === 'horizontal' ? e.clientX : e.clientY
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging.value) return
  const current = props.direction === 'horizontal' ? e.clientX : e.clientY
  emit('resize', current - startPos)
  startPos = current
}

function onMouseUp(): void {
  dragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    class="resize-handle shrink-0"
    :class="direction === 'horizontal' ? 'w-1 cursor-col-resize hover:bg-codex-accent/20' : 'h-1 cursor-row-resize hover:bg-codex-accent/20'"
    @mousedown="onMouseDown"
  />
</template>
