# Stage 1: Build Go Binary
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /payuu-media-server main.go

# Stage 2: Runtime image with FFmpeg for RTMP Fanout
FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata ffmpeg
WORKDIR /root/
COPY --from=builder /payuu-media-server .
EXPOSE 8080
EXPOSE 50000-50050/udp
ENV PAYUU_HTTP_PORT=8080
CMD ["./payuu-media-server"]