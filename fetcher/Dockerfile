# Build from repository root: docker build -f fetcher/Dockerfile .
FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY fetcher/pom.xml ./pom.xml
COPY fetcher/src ./src
RUN mvn --batch-mode verify

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/web-switcher-fetcher-0.2.0.jar ./fetcher.jar
ENV FETCHER_BIND=0.0.0.0 FETCHER_PORT=8081
USER 65532:65532
EXPOSE 8081
ENTRYPOINT ["java","-XX:MaxRAMPercentage=65","-jar","/app/fetcher.jar"]
