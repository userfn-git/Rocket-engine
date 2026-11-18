local RL_AxisEngine = {
    cur_x = 0.0,
    cur_y = 0.0,
    deadzone = 0.05,
    max_magnitude = 1.0,
    tick_ms = 8
}

function RL_AxisEngine:NormalizeVector(raw_x, raw_y)
    local mag = math.sqrt((raw_x * raw_x) + (raw_y * raw_y))
    if mag < self.deadzone then return 0.0, 0.0 end
    local norm_mag = math.min((mag - self.deadzone) / (1.0 - self.deadzone), self.max_magnitude)
    local scale = norm_mag / mag
    return raw_x * scale, raw_y * scale
end

function RL_AxisEngine:StepAxis(target_x, target_y, responsiveness)
    local tx, ty = self:NormalizeVector(target_x, target_y)
    local alpha = math.max(0.01, math.min(responsiveness or 0.35, 1.0))
    self.cur_x = self.cur_x + (tx - self.cur_x) * alpha
    self.cur_y = self.cur_y + (ty - self.cur_y) * alpha
    return self.cur_x, self.cur_y
end

function RL_AxisEngine:GetSpeedflipVector(direction)
    local angle_rad = math.rad(28.0)
    local vx = math.sin(angle_rad) * (direction or -1)
    local vy = -math.cos(angle_rad)
    return self:NormalizeVector(vx, vy)
end

return RL_AxisEngine
